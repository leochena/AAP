/**
 * ModelClient - 统一模型客户端
 * 根据 ModelConfig.protocol 分派到对应的协议实现
 */

import { Message, ModelConfig, ModelResponse } from '@/lib/types';
import { extractThinkingBlocks } from '@/lib/features/thinking-visualization';
import {
  callOpenAIProtocol,
  callOpenAIProtocolNonStream,
  CallResult,
} from '@/lib/clients/openai-protocol';
import {
  callAnthropicProtocol,
  callAnthropicProtocolNonStream,
} from '@/lib/clients/anthropic-protocol';
import {
  callOllamaProtocol,
  callOllamaProtocolNonStream,
} from '@/lib/clients/ollama-protocol';

export interface ModelStreamOptions {
  model: ModelConfig;
  messages: Message[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  maxTokens?: number;
  temperature?: number;
}

export async function streamModel(
  options: ModelStreamOptions
): Promise<ModelResponse> {
  const start = Date.now();
  let result: CallResult;
  try {
    switch (options.model.protocol) {
      case 'openai':
        result = await callOpenAIProtocol(options);
        break;
      case 'anthropic':
        result = await callAnthropicProtocol(options);
        break;
      case 'ollama':
        result = await callOllamaProtocol(options);
        break;
      default:
        throw new Error(
          `Unknown protocol: ${(options.model as ModelConfig).protocol}`
        );
    }
  } catch (err) {
    return {
      modelId: options.model.id,
      content: '',
      tokensIn: 0,
      tokensOut: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const thinkingBlocks = extractThinkingBlocks(result.content, options.model.id);
  return {
    modelId: options.model.id,
    content: result.content,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    durationMs: Date.now() - start,
    thinkingBlocks,
  };
}

export async function callModelNonStream(
  model: ModelConfig,
  messages: Message[],
  options: { signal?: AbortSignal; maxTokens?: number; temperature?: number } = {}
): Promise<CallResult> {
  switch (model.protocol) {
    case 'openai':
      return callOpenAIProtocolNonStream(model, messages, options);
    case 'anthropic':
      return callAnthropicProtocolNonStream(model, messages, options);
    case 'ollama':
      return callOllamaProtocolNonStream(model, messages, options);
    default:
      throw new Error(`Unknown protocol: ${(model as ModelConfig).protocol}`);
  }
}
