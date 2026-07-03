/**
 * OpenAI 兼容协议客户端
 * 适用于：OpenAI 官方、各种 OpenAI-compatible 中转、本地多模型端点（如用户的 192.168.0.122）
 */

import { Message, ModelConfig } from '@/lib/types';
import { ToolDefinition } from '@/lib/tools/types';

export interface StreamCallOptions {
  model: ModelConfig;
  messages: Message[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  maxTokens?: number;
  temperature?: number;
  /** 工具定义，传入后请求体会带 tools 字段，模型可能返回 tool_calls。 */
  tools?: ToolDefinition[];
}

export interface RawToolCall {
  id: string;
  name: string;
  /** 累积的 arguments JSON 字符串。stream 阶段是片段拼接的结果。 */
  argsJson: string;
}

export interface CallResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  /** 模型这一轮发起的 tool calls。空数组表示模型直接回答没有调工具。 */
  toolCalls: RawToolCall[];
  /** OpenAI finish_reason: 'stop' | 'tool_calls' | 'length' | ... */
  finishReason: string;
}

export async function callOpenAIProtocol(
  options: StreamCallOptions
): Promise<CallResult> {
  const { model, messages, signal, onDelta, maxTokens = 4096, temperature, tools } = options;

  if (!model.apiKey) {
    throw new Error(`Model "${model.id}": API key is required for OpenAI protocol`);
  }

  const baseUrl = model.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/chat/completions`;

  const body: Record<string, unknown> = {
    model: model.model,
    messages,
    stream: true,
    max_tokens: maxTokens,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `OpenAI protocol error (${model.id}): HTTP ${response.status} ${response.statusText}\n${text}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`OpenAI protocol error (${model.id}): no response body`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let tokensIn = 0;
  let tokensOut = 0;
  let finishReason = '';
  // tool_calls 是按 index 累积的，每个 chunk 给一段 arguments
  const toolCallsByIndex: Map<number, RawToolCall> = new Map();

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || !line.startsWith('data: ')) return;
    const payload = line.slice(6);
    if (payload === '[DONE]') return;

    try {
      const parsed = JSON.parse(payload);
      const choice = parsed.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        fullContent += delta;
        onDelta?.(delta);
      }
      const toolCallsDelta = choice?.delta?.tool_calls;
      if (Array.isArray(toolCallsDelta)) {
        for (const tcd of toolCallsDelta) {
          const idx = typeof tcd.index === 'number' ? tcd.index : 0;
          let entry = toolCallsByIndex.get(idx);
          if (!entry) {
            entry = { id: tcd.id ?? `call_${idx}`, name: tcd.function?.name ?? '', argsJson: '' };
            toolCallsByIndex.set(idx, entry);
          } else {
            if (tcd.id) entry.id = tcd.id;
            if (tcd.function?.name) entry.name = tcd.function.name;
          }
          if (typeof tcd.function?.arguments === 'string') {
            entry.argsJson += tcd.function.arguments;
          }
        }
      }
      if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      if (parsed.usage) {
        tokensIn = parsed.usage.prompt_tokens ?? tokensIn;
        tokensOut = parsed.usage.completion_tokens ?? tokensOut;
      }
    } catch {
      // 忽略非 JSON 数据行（如部分中转返回的 keepalive 行）
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

  const toolCalls = [...toolCallsByIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c)
    .filter(c => c.name);

  return {
    content: fullContent,
    tokensIn,
    tokensOut,
    toolCalls,
    finishReason: finishReason || (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
  };
}

/**
 * 非流式调用（用于挑刺 / 投票等需要完整 JSON 输出的场景）
 */
export async function callOpenAIProtocolNonStream(
  model: ModelConfig,
  messages: Message[],
  options: { signal?: AbortSignal; maxTokens?: number; temperature?: number; tools?: ToolDefinition[] } = {}
): Promise<CallResult> {
  if (!model.apiKey) {
    throw new Error(`Model "${model.id}": API key is required for OpenAI protocol`);
  }

  const baseUrl = model.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/chat/completions`;

  const body: Record<string, unknown> = {
    model: model.model,
    messages,
    stream: false,
    max_tokens: options.maxTokens ?? 4096,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `OpenAI protocol error (${model.id}): HTTP ${response.status} ${response.statusText}\n${text}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>;
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = data.choices?.[0]?.message;
  const toolCalls: RawToolCall[] = (message?.tool_calls ?? []).map(tc => ({
    id: tc.id,
    name: tc.function?.name ?? '',
    argsJson: tc.function?.arguments ?? '',
  })).filter(t => t.name);
  return {
    content: message?.content ?? '',
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    toolCalls,
    finishReason: data.choices?.[0]?.finish_reason ?? 'stop',
  };
}

function estimateTokens(messages: Message[], output: string) {
  const inputChars = messages.reduce(
    (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0),
    0
  );
  return {
    tokensIn: Math.ceil(inputChars / 2.5),
    tokensOut: Math.ceil(output.length / 2.5),
  };
}
