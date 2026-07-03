/**
 * OpenAI tool-calling 循环
 *
 * 一次"生成"对外是一条消息，但内部可能跑多轮：
 *   call → tool_calls? → dispatch → append tool_result → call → ... → finish='stop'
 *
 * 这是把"工具调用 + 求真"接入 AdversarialEngine 的核心。
 */

import { Message, ModelConfig } from '@/lib/types';
import { ToolCall, ToolDefinition, ToolCtx } from '@/lib/tools/types';
import { ToolRegistry } from '@/lib/tools/registry';
import { callOpenAIProtocol, RawToolCall } from './openai-protocol';

export interface StreamWithToolsOptions {
  model: ModelConfig;
  messages: Message[];
  tools: ToolDefinition[];
  registry: ToolRegistry;
  ctx: ToolCtx;
  signal?: AbortSignal;
  maxIterations?: number;
  maxTokens?: number;
  temperature?: number;
  onDelta?: (delta: string) => void;
  onToolCall?: (call: ToolCall, result: { ok: boolean; content?: string; error?: string }) => void;
  /** Concession 工具被调用后，告知调用方"该模型已退出"，方便引擎短路。 */
  isWithdrawn?: () => boolean;
}

export interface ToolCallLogEntry {
  call: ToolCall;
  ok: boolean;
  content?: string;
  error?: string;
}

export interface StreamWithToolsResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  toolCallsLog: ToolCallLogEntry[];
  /** 因 maxIterations 触顶或外部中止而强行结束 */
  truncated: boolean;
}

/** OpenAI wire-format messages may include tool_calls / tool roles. */
type WireMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; content: string; tool_call_id: string };

function safeJsonParse(s: string): unknown {
  if (!s.trim()) return {};
  try { return JSON.parse(s); } catch { return { __raw: s }; }
}

export async function streamWithTools(opts: StreamWithToolsOptions): Promise<StreamWithToolsResult> {
  const {
    model,
    tools,
    registry,
    ctx,
    signal,
    maxIterations = 6,
    maxTokens,
    temperature,
    onDelta,
    onToolCall,
    isWithdrawn,
  } = opts;

  // Internally we work with wire-format (messages + tool roles).
  const wire: WireMessage[] = opts.messages.map(m => ({ role: m.role, content: m.content }));

  let totalIn = 0;
  let totalOut = 0;
  let finalContent = '';
  const callsLog: ToolCallLogEntry[] = [];
  let truncated = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    if (isWithdrawn?.()) break;

    const result = await callOpenAIProtocol({
      model,
      messages: wire as unknown as Message[],   // 透传，openai-protocol 不重映射
      tools,
      signal,
      onDelta,
      maxTokens,
      temperature,
    });

    totalIn += result.tokensIn;
    totalOut += result.tokensOut;

    if (result.toolCalls.length === 0) {
      // 终态：没有工具调用，模型直接回答
      finalContent = result.content;
      break;
    }

    // 把这一轮 assistant 的输出（含 tool_calls）追加到对话
    wire.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.argsJson || '{}' },
      })),
    });
    finalContent = result.content || finalContent;     // keep最后一次有内容的 assistant 文本

    // 顺序分派工具，把每个 result 作为一条 role:'tool' 消息追加
    for (const raw of result.toolCalls) {
      const call: ToolCall = { id: raw.id, name: raw.name, args: safeJsonParse(raw.argsJson) };
      const dispatchResult = await registry.dispatch(call, ctx);
      callsLog.push(dispatchResult.ok
        ? { call, ok: true, content: dispatchResult.content }
        : { call, ok: false, error: dispatchResult.error });
      onToolCall?.(call, dispatchResult.ok
        ? { ok: true, content: dispatchResult.content }
        : { ok: false, error: dispatchResult.error });
      const toolContent = dispatchResult.ok
        ? dispatchResult.content
        : `ERROR: ${dispatchResult.error}`;
      wire.push({
        role: 'tool',
        content: toolContent,
        tool_call_id: raw.id,
      });
      // concede 工具调用后，模型已记录退出；下一轮 iteration 开头会 break
    }

    if (iter === maxIterations - 1) {
      truncated = true;
    }
  }

  if (truncated && !isWithdrawn?.()) {
    wire.push({
      role: 'user',
      content:
        '工具调用预算已经用完。现在必须停止调用工具，基于上面的工具结果给出最终答案；' +
        '如果证据不足，请明确说明不确定性，不要继续搜索，也不要编造证据。',
    });
    const result = await callOpenAIProtocol({
      model,
      messages: wire as unknown as Message[],
      signal,
      onDelta,
      maxTokens,
      temperature,
    });
    totalIn += result.tokensIn;
    totalOut += result.tokensOut;
    if (result.content.trim()) {
      finalContent = result.content;
    }
  }

  return {
    content: finalContent,
    tokensIn: totalIn,
    tokensOut: totalOut,
    toolCallsLog: callsLog,
    truncated,
  };
}
