import { describe, expect, it, vi } from 'vitest';
import type { RunRequest, RunResult } from '@/lib/types';
import { createAnthropicRoutes } from '../anthropic-compat';
import { createOpenAIRoutes } from '../openai-compat';

function result(): RunResult {
  return {
    runId: 'run_1',
    responses: [{
      modelId: 'm1',
      content: 'answer',
      tokensIn: 1,
      tokensOut: 2,
      durationMs: 3,
      toolCalls: [{ name: 'search', ok: false, error: 'timeout' }],
    }],
    challenges: [],
    metrics: {},
    durationMs: 4,
    reportPath: 'C:\\tmp\\run_1.md',
  };
}

describe('compatible HTTP routes', () => {
  it('passes OpenAI generation params and a request abort signal into EngineHub', async () => {
    let capturedRequest: RunRequest | undefined;
    let capturedSignal: AbortSignal | undefined;
    const hub = {
      startRun: vi.fn((request: RunRequest, signal?: AbortSignal) => {
        capturedRequest = request;
        capturedSignal = signal;
        return { runId: 'run_1', engine: {}, promise: Promise.resolve(result()) };
      }),
    };
    const app = createOpenAIRoutes(hub as any);

    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'adversarial:vote',
        messages: [{ role: 'user', content: 'q' }],
        max_tokens: 321,
        temperature: 0.4,
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedRequest?.generation).toEqual({ maxTokens: 321, temperature: 0.4 });
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    const json = await response.json() as any;
    expect(json.x_adversarial.responses[0].toolCalls).toEqual([
      { name: 'search', ok: false, error: 'timeout' },
    ]);
  });

  it('passes Anthropic generation params and a request abort signal into EngineHub', async () => {
    let capturedRequest: RunRequest | undefined;
    let capturedSignal: AbortSignal | undefined;
    const hub = {
      startRun: vi.fn((request: RunRequest, signal?: AbortSignal) => {
        capturedRequest = request;
        capturedSignal = signal;
        return { runId: 'run_1', engine: {}, promise: Promise.resolve(result()) };
      }),
    };
    const app = createAnthropicRoutes(hub as any);

    const response = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'adversarial:debate',
        messages: [{ role: 'user', content: 'q' }],
        max_tokens: 123,
        temperature: 0.2,
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedRequest?.generation).toEqual({ maxTokens: 123, temperature: 0.2 });
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    const json = await response.json() as any;
    expect(json.x_adversarial.responses[0].toolCalls).toEqual([
      { name: 'search', ok: false, error: 'timeout' },
    ]);
  });
});
