import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamWithTools } from '../openai-tool-loop';
import { ToolRegistry } from '@/lib/tools/registry';
import type { ModelConfig, Message } from '@/lib/types';

const model: ModelConfig = {
  id: 'm', protocol: 'openai',
  baseUrl: 'http://example.com/v1',
  apiKey: 'sk-test',
  model: 'mock-model',
  enabled: true,
};

const ctx = { modelId: 'm', runId: 'r' } as const;

function sse(chunks: object[]): string {
  return chunks.map(c => `data: ${JSON.stringify(c)}\n`).join('') + 'data: [DONE]\n';
}

function streamResponse(text: string): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }), { status: 200 });
}

describe('streamWithTools', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  it('runs a single iteration when no tool calls', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamResponse(sse([
        { choices: [{ delta: { content: 'Direct answer' } }] },
        { choices: [{ finish_reason: 'stop' }] },
      ]))
    ) as any;

    const registry = new ToolRegistry();
    const messages: Message[] = [{ role: 'user', content: 'q' }];
    const result = await streamWithTools({
      model, messages, tools: [], registry, ctx,
    });

    expect(result.content).toBe('Direct answer');
    expect(result.toolCallsLog).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('dispatches tool, appends result, then completes on next iter', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return streamResponse(sse([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'echo', arguments: '' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"text":"hi"}' } }] } }] },
          { choices: [{ finish_reason: 'tool_calls' }] },
        ]));
      }
      return streamResponse(sse([
        { choices: [{ delta: { content: 'Final after tool' } }] },
        { choices: [{ finish_reason: 'stop' }] },
      ]));
    }) as any;

    const registry = new ToolRegistry();
    registry.register(
      { name: 'echo', description: 'echo', parameters: {} },
      async args => ({ id: '', ok: true, content: `echoed ${(args as any).text}` })
    );

    const result = await streamWithTools({
      model,
      messages: [{ role: 'user', content: 'q' }],
      tools: [{ name: 'echo', description: 'echo', parameters: {} }],
      registry,
      ctx,
    });

    expect(callCount).toBe(2);
    expect(result.content).toBe('Final after tool');
    expect(result.toolCallsLog).toHaveLength(1);
    expect(result.toolCallsLog[0].call.name).toBe('echo');
    expect((result.toolCallsLog[0].call.args as any).text).toBe('hi');
    expect(result.toolCallsLog[0].ok).toBe(true);
  });

  it('records failed tool dispatches as failed audit entries', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return streamResponse(sse([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'fail', arguments: '{}' } }] } }] },
          { choices: [{ finish_reason: 'tool_calls' }] },
        ]));
      }
      return streamResponse(sse([
        { choices: [{ delta: { content: 'Final after failure' } }] },
        { choices: [{ finish_reason: 'stop' }] },
      ]));
    }) as any;

    const registry = new ToolRegistry();
    registry.register(
      { name: 'fail', description: 'fail', parameters: {} },
      async () => ({ id: '', ok: false, error: 'tool exploded' })
    );

    const onToolCall = vi.fn();
    const result = await streamWithTools({
      model,
      messages: [{ role: 'user', content: 'q' }],
      tools: [{ name: 'fail', description: 'fail', parameters: {} }],
      registry,
      ctx,
      onToolCall,
    });

    expect(result.content).toBe('Final after failure');
    expect(result.toolCallsLog).toEqual([
      {
        call: { id: 'call_1', name: 'fail', args: {} },
        ok: false,
        error: 'tool exploded',
      },
    ]);
    expect(onToolCall).toHaveBeenCalledWith(
      { id: 'call_1', name: 'fail', args: {} },
      { ok: false, error: 'tool exploded' }
    );
  });

  it('stops early when isWithdrawn returns true', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return streamResponse(sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 'concede', arguments: '{"reason":"x"}' } }] } }] },
        { choices: [{ finish_reason: 'tool_calls' }] },
      ]));
    }) as any;

    let withdrawn = false;
    const registry = new ToolRegistry();
    registry.register(
      { name: 'concede', description: 'admit', parameters: {}, hidden: true },
      async () => { withdrawn = true; return { id: '', ok: true, content: 'noted' }; }
    );

    const result = await streamWithTools({
      model,
      messages: [{ role: 'user', content: 'q' }],
      tools: [{ name: 'concede', description: 'admit', parameters: {}, hidden: true }],
      registry,
      ctx,
      isWithdrawn: () => withdrawn,
    });

    // Iteration 1: makes tool call, concede sets withdrawn. Iteration 2 short-circuits.
    expect(callCount).toBe(1);
    expect(result.toolCallsLog).toHaveLength(1);
    expect(result.toolCallsLog[0].ok).toBe(true);
  });

  it('caps at maxIterations', async () => {
    // Always returns tool_calls, never stop
    globalThis.fetch = vi.fn(async () =>
      streamResponse(sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 'echo', arguments: '{}' } }] } }] },
        { choices: [{ finish_reason: 'tool_calls' }] },
      ]))
    ) as any;

    const registry = new ToolRegistry();
    registry.register(
      { name: 'echo', description: 'echo', parameters: {} },
      async () => ({ id: '', ok: true, content: 'x' })
    );

    const result = await streamWithTools({
      model,
      messages: [{ role: 'user', content: 'q' }],
      tools: [{ name: 'echo', description: 'echo', parameters: {} }],
      registry,
      ctx,
      maxIterations: 3,
    });

    expect(result.truncated).toBe(true);
    expect(result.toolCallsLog).toHaveLength(3);
  });

  it('forces a final text answer after tool budget is exhausted', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount <= 2) {
        return streamResponse(sse([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${callCount}`, type: 'function', function: { name: 'echo', arguments: '{}' } }] } }] },
          { choices: [{ finish_reason: 'tool_calls' }] },
        ]));
      }
      return streamResponse(sse([
        { choices: [{ delta: { content: 'Final from gathered evidence' } }] },
        { choices: [{ finish_reason: 'stop' }] },
      ]));
    }) as any;

    const registry = new ToolRegistry();
    registry.register(
      { name: 'echo', description: 'echo', parameters: {} },
      async () => ({ id: '', ok: true, content: 'tool-result' })
    );

    const result = await streamWithTools({
      model,
      messages: [{ role: 'user', content: 'q' }],
      tools: [{ name: 'echo', description: 'echo', parameters: {} }],
      registry,
      ctx,
      maxIterations: 2,
    });

    expect(callCount).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.content).toBe('Final from gathered evidence');
    const finalBody = JSON.parse((globalThis.fetch as any).mock.calls[2][1].body);
    expect(finalBody.tools).toBeUndefined();
    expect(finalBody.messages.at(-1).content).toContain('工具调用预算已经用完');
  });
});
