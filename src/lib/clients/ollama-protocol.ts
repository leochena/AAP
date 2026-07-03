/**
 * Ollama 协议客户端
 * 适用于 localhost:11434 上的 Ollama 服务（OpenAI-incompatible 原生协议）
 */

import { Message, ModelConfig } from '@/lib/types';
import type { CallResult, StreamCallOptions } from './openai-protocol';

export async function callOllamaProtocol(
  options: StreamCallOptions
): Promise<CallResult> {
  const { model, messages, signal, onDelta, maxTokens, temperature } = options;

  const baseUrl = model.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/api/chat`;

  const generationOptions: Record<string, unknown> = {};
  if (maxTokens !== undefined) generationOptions.num_predict = maxTokens;
  if (temperature !== undefined) generationOptions.temperature = temperature;

  const body: Record<string, unknown> = {
    model: model.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (Object.keys(generationOptions).length > 0) body.options = generationOptions;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Ollama protocol error (${model.id}): HTTP ${response.status} ${response.statusText}\n${text}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`Ollama protocol error (${model.id}): no response body`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let tokensIn = 0;
  let tokensOut = 0;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      const delta = parsed.message?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        fullContent += delta;
        onDelta?.(delta);
      }
      if (parsed.done) {
        tokensIn = parsed.prompt_eval_count ?? tokensIn;
        tokensOut = parsed.eval_count ?? tokensOut;
      }
    } catch {
      // ignore
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      processLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const line of buffer.split('\n')) processLine(line);
  }

  if (tokensIn === 0 && tokensOut === 0) {
    const est = estimateTokens(messages, fullContent);
    tokensIn = est.tokensIn;
    tokensOut = est.tokensOut;
  }

  return { content: fullContent, tokensIn, tokensOut, toolCalls: [], finishReason: 'stop' };
}

export async function callOllamaProtocolNonStream(
  model: ModelConfig,
  messages: Message[],
  options: { signal?: AbortSignal; maxTokens?: number; temperature?: number } = {}
): Promise<CallResult> {
  const baseUrl = model.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/api/chat`;

  const generationOptions: Record<string, unknown> = {};
  if (options.maxTokens !== undefined) generationOptions.num_predict = options.maxTokens;
  if (options.temperature !== undefined) generationOptions.temperature = options.temperature;

  const body: Record<string, unknown> = {
    model: model.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: false,
  };
  if (Object.keys(generationOptions).length > 0) body.options = generationOptions;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Ollama protocol error (${model.id}): HTTP ${response.status} ${response.statusText}\n${text}`
    );
  }

  const data = (await response.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  return {
    content: data.message?.content ?? '',
    tokensIn: data.prompt_eval_count ?? 0,
    tokensOut: data.eval_count ?? 0,
    toolCalls: [],
    finishReason: 'stop',
  };
}

function estimateTokens(messages: Message[], output: string) {
  const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return {
    tokensIn: Math.ceil(inputChars / 2.5),
    tokensOut: Math.ceil(output.length / 2.5),
  };
}
