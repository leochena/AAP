/**
 * Anthropic 兼容协议客户端
 * 适用于：Claude 官方 API、Anthropic-compatible 中转
 */

import { Message, ModelConfig } from '@/lib/types';
import type { CallResult, StreamCallOptions } from './openai-protocol';

export async function callAnthropicProtocol(
  options: StreamCallOptions
): Promise<CallResult> {
  const { model, messages, signal, onDelta, maxTokens = 4096, temperature } = options;

  if (!model.apiKey) {
    throw new Error(`Model "${model.id}": API key is required for Anthropic protocol`);
  }

  const baseUrl = model.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/messages`;

  // Anthropic 把 system 单独传入，messages 只能有 user/assistant
  const systemMessages = messages.filter(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const systemPrompt = systemMessages.map(m => m.content).join('\n\n') || undefined;

  const body: Record<string, unknown> = {
    model: model.model,
    messages: chatMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    stream: true,
    max_tokens: maxTokens,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (systemPrompt) body.system = systemPrompt;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': model.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Anthropic protocol error (${model.id}): HTTP ${response.status} ${response.statusText}\n${text}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`Anthropic protocol error (${model.id}): no response body`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let tokensIn = 0;
  let tokensOut = 0;

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || !line.startsWith('data: ')) return;
    const payload = line.slice(6);

    try {
      const parsed = JSON.parse(payload);
      if (parsed.type === 'message_start') {
        tokensIn = parsed.message?.usage?.input_tokens ?? 0;
      } else if (parsed.type === 'content_block_delta') {
        const delta = parsed.delta?.text;
        if (typeof delta === 'string' && delta.length > 0) {
          fullContent += delta;
          onDelta?.(delta);
        }
      } else if (parsed.type === 'message_delta') {
        tokensOut = parsed.usage?.output_tokens ?? tokensOut;
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

    for (const rawLine of lines) {
      processLine(rawLine);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const rawLine of buffer.split('\n')) processLine(rawLine);
  }

  if (tokensIn === 0 && tokensOut === 0) {
    const est = estimateTokens(messages, fullContent);
    tokensIn = est.tokensIn;
    tokensOut = est.tokensOut;
  }

  return { content: fullContent, tokensIn, tokensOut, toolCalls: [], finishReason: 'stop' };
}

export async function callAnthropicProtocolNonStream(
  model: ModelConfig,
  messages: Message[],
  options: { signal?: AbortSignal; maxTokens?: number; temperature?: number } = {}
): Promise<CallResult> {
  if (!model.apiKey) {
    throw new Error(`Model "${model.id}": API key is required for Anthropic protocol`);
  }

  const baseUrl = model.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/messages`;

  const systemMessages = messages.filter(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const systemPrompt = systemMessages.map(m => m.content).join('\n\n') || undefined;

  const body: Record<string, unknown> = {
    model: model.model,
    messages: chatMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    stream: false,
    max_tokens: options.maxTokens ?? 4096,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (systemPrompt) body.system = systemPrompt;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': model.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Anthropic protocol error (${model.id}): HTTP ${response.status} ${response.statusText}\n${text}`
    );
  }

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const content =
    Array.isArray(data.content)
      ? data.content
          .filter(c => c.type === 'text')
          .map(c => c.text ?? '')
          .join('')
      : '';

  return {
    content,
    tokensIn: data.usage?.input_tokens ?? 0,
    tokensOut: data.usage?.output_tokens ?? 0,
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
