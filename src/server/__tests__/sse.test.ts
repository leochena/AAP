import { describe, expect, it, vi } from 'vitest';
import type { EngineEvent, RunResult } from '@/lib/types';
import { buildAnthropicStream, buildOpenAIStream } from '../sse';

function result(): RunResult {
  return {
    runId: 'run_1',
    responses: [{
      modelId: 'm1',
      content: 'answer',
      tokensIn: 1,
      tokensOut: 2,
      durationMs: 3,
      toolCalls: [{ name: 'fetch_url', ok: true }],
    }],
    challenges: [],
    metrics: {},
    durationMs: 4,
    reportPath: 'C:\\tmp\\run_1.md',
  };
}

function completeEvent(): EngineEvent {
  return {
    runId: 'run_1',
    type: 'run-complete',
    timestamp: Date.now(),
    data: { result: result() },
  };
}

function fakeHub() {
  let handler: ((event: EngineEvent) => void) | undefined;
  return {
    hub: {
      subscribeRun: vi.fn((_runId: string, h: (event: EngineEvent) => void) => {
        handler = h;
        return vi.fn();
      }),
    },
    emit: (event: EngineEvent) => handler?.(event),
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe('SSE stream builders', () => {
  it('delivers OpenAI terminal chunks when completion arrives immediately after subscription', async () => {
    const { hub, emit } = fakeHub();
    const stream = buildOpenAIStream(hub as any, {
      runId: 'run_1',
      modelLabel: 'adversarial:vote',
      question: 'q',
    });

    emit(completeEvent());
    const text = await readAll(stream);

    expect(hub.subscribeRun).toHaveBeenCalledWith('run_1', expect.any(Function));
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain('"toolCalls":[{"name":"fetch_url","ok":true}]');
    expect(text).toContain('data: [DONE]');
  });

  it('delivers Anthropic message_stop when completion arrives immediately after subscription', async () => {
    const { hub, emit } = fakeHub();
    const stream = buildAnthropicStream(hub as any, {
      runId: 'run_1',
      modelLabel: 'adversarial:debate',
      question: 'q',
    });

    emit(completeEvent());
    const text = await readAll(stream);

    expect(hub.subscribeRun).toHaveBeenCalledWith('run_1', expect.any(Function));
    expect(text).toContain('event: message_stop');
    expect(text).toContain('"toolCalls":[{"name":"fetch_url","ok":true}]');
    expect(text).toContain('"x_adversarial"');
  });
});
