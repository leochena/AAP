import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, ModelConfig } from '@/lib/types';
import { callAnthropicProtocol } from '../anthropic-protocol';
import { callOllamaProtocol } from '../ollama-protocol';
import { callOpenAIProtocol } from '../openai-protocol';

const messages: Message[] = [{ role: 'user', content: 'q' }];

const openAIModel: ModelConfig = {
  id: 'openai-model',
  protocol: 'openai',
  baseUrl: 'http://example.com/v1',
  apiKey: 'sk-test',
  model: 'upstream-openai',
  enabled: true,
};

const anthropicModel: ModelConfig = {
  id: 'anthropic-model',
  protocol: 'anthropic',
  baseUrl: 'http://example.com',
  apiKey: 'sk-test',
  model: 'upstream-anthropic',
  enabled: true,
};

const ollamaModel: ModelConfig = {
  id: 'ollama-model',
  protocol: 'ollama',
  baseUrl: 'http://example.com',
  apiKey: '',
  model: 'upstream-ollama',
  enabled: true,
};

function streamResponse(text: string): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }), { status: 200 });
}

function dataLine(payload: object): string {
  return `data: ${JSON.stringify(payload)}`;
}

describe('streaming protocol clients', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('parses a final OpenAI SSE frame without a trailing newline and forwards generation params', async () => {
    let requestBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return streamResponse(dataLine({
        choices: [{
          delta: {
            content: 'tail',
            tool_calls: [{
              index: 0,
              id: 'call_1',
              function: { name: 'echo', arguments: '{"text":"hi"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 7, completion_tokens: 8 },
      }));
    }) as any;

    const result = await callOpenAIProtocol({
      model: openAIModel,
      messages,
      maxTokens: 123,
      temperature: 0.25,
    });

    expect(requestBody.max_tokens).toBe(123);
    expect(requestBody.temperature).toBe(0.25);
    expect(result.content).toBe('tail');
    expect(result.tokensIn).toBe(7);
    expect(result.tokensOut).toBe(8);
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'echo', argsJson: '{"text":"hi"}' },
    ]);
  });

  it('parses a final Anthropic SSE data frame without a trailing newline and forwards generation params', async () => {
    let requestBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return streamResponse([
        dataLine({ type: 'message_start', message: { usage: { input_tokens: 11 } } }),
        '',
        dataLine({ type: 'content_block_delta', delta: { text: 'answer' } }),
        '',
        dataLine({ type: 'message_delta', usage: { output_tokens: 12 } }),
      ].join('\n'));
    }) as any;

    const result = await callAnthropicProtocol({
      model: anthropicModel,
      messages,
      maxTokens: 88,
      temperature: 0.3,
    });

    expect(requestBody.max_tokens).toBe(88);
    expect(requestBody.temperature).toBe(0.3);
    expect(result.content).toBe('answer');
    expect(result.tokensIn).toBe(11);
    expect(result.tokensOut).toBe(12);
  });

  it('parses a final Ollama NDJSON frame without a trailing newline and forwards generation params', async () => {
    let requestBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return streamResponse(JSON.stringify({
        message: { content: 'done' },
        done: true,
        prompt_eval_count: 5,
        eval_count: 6,
      }));
    }) as any;

    const result = await callOllamaProtocol({
      model: ollamaModel,
      messages,
      maxTokens: 55,
      temperature: 0.7,
    });

    expect(requestBody.options).toEqual({ num_predict: 55, temperature: 0.7 });
    expect(result.content).toBe('done');
    expect(result.tokensIn).toBe(5);
    expect(result.tokensOut).toBe(6);
  });
});
