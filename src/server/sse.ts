/**
 * 把 EngineHub 的事件流翻译成 OpenAI Chat Completions 兼容的 SSE chunks
 */

import {
  ChunkEventData,
  EngineEvent,
  RunCompleteEventData,
  RunFailedEventData,
} from '@/lib/types';
import { EngineHub } from '@/engine/EngineHub';
import { formatUserOpinionResult } from '@/lib/features/user-opinion';
import { formatProtocolOutputContract } from '@/lib/features/output-contract';
import { formatStructuredDeliberation } from '@/lib/features/structured-deliberation';

const enc = new TextEncoder();

interface OpenAIChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: 'assistant'; content?: string };
    finish_reason: null | 'stop';
  }>;
}

function makeChunk(
  id: string,
  modelLabel: string,
  delta: { role?: 'assistant'; content?: string },
  finish_reason: null | 'stop' = null
): OpenAIChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: modelLabel,
    choices: [{ index: 0, delta, finish_reason }],
  };
}

function ssePayload(obj: unknown): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

const SSE_DONE = enc.encode('data: [DONE]\n\n');

// ---- 共享格式化（OpenAI 与 Anthropic 流共用）----

function formatChallengeLine(challenge: import('@/lib/types').Challenge): string {
  return (
    `- **${challenge.challengerId}** → **${challenge.targetId}**: ` +
    `[${challenge.severity}] ${challenge.type}: ${challenge.reason}\n`
  );
}

function formatVotingBlock(result: import('@/lib/types').VotingResult): string {
  const winnerLine = result.winner
    ? `**获胜:** ${result.winner} (共识度 ${(result.consensusLevel * 100).toFixed(1)}%)\n`
    : '**结果:** 平局\n';
  const totals = Object.entries(result.totals)
    .map(([id, v]) => `  - ${id}: ${v.toFixed(2)}`)
    .join('\n');
  return `${winnerLine}${totals}\n`;
}

function formatUserOpinionBlock(result?: import('@/lib/types').UserOpinionResult): string {
  const block = formatUserOpinionResult(result);
  return block ? `${block}\n` : '';
}

function formatProtocolBlock(result?: import('@/lib/types').ProtocolOutputContract): string {
  const block = formatProtocolOutputContract(result);
  return block ? `${block}\n` : '';
}

function formatStructuredDeliberationBlock(result?: import('@/lib/types').StructuredDeliberationResult): string {
  const block = formatStructuredDeliberation(result);
  return block ? `${block}\n` : '';
}

/**
 * 创建 OpenAI Chat Completions 兼容的 SSE 流
 *
 * 多模型并行输出策略：
 *   - 用 Markdown 格式合并多个模型的输出，标识每个模型的来源
 *   - 整个对抗过程（生成 + 挑刺 + 投票）作为同一个流式回复
 *   - 最后一个 chunk 携带 x_adversarial 元数据
 */
export function buildOpenAIStream(
  hub: EngineHub,
  request: { runId: string; modelLabel: string; question: string; passthrough?: boolean }
): ReadableStream<Uint8Array> {
  const { runId, modelLabel, passthrough = false } = request;
  const responseId = `chatcmpl-${runId}`;
  let started = false;
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  // 跟踪每个模型最近输出的位置，便于在同一流中区分多模型输出
  const modelHeaders = new Set<string>();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (data: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(data);
        } catch {
          // controller already closed; nothing to do
          closed = true;
        }
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      };

      const onEvent = (event: EngineEvent) => {
        if (closed) return;

        if (!started) {
          started = true;
          safeEnqueue(
            ssePayload(makeChunk(responseId, modelLabel, { role: 'assistant', content: '' }))
          );
        }

        if (event.type === 'chunk') {
          const data = event.data as ChunkEventData;
          // 透传时只有一个模型，不加 markdown header；多模型时第一次见到该模型先输出标题
          if (!passthrough && !modelHeaders.has(data.modelId)) {
            modelHeaders.add(data.modelId);
            const header = `\n\n## ${data.modelId}\n\n`;
            safeEnqueue(ssePayload(makeChunk(responseId, modelLabel, { content: header })));
          }
          safeEnqueue(ssePayload(makeChunk(responseId, modelLabel, { content: data.delta })));
        } else if (!passthrough && event.type === 'phase-change') {
          const { phase } = event.data as { phase: string };
          if (phase === 'deliberation') {
            safeEnqueue(
              ssePayload(
                makeChunk(responseId, modelLabel, {
                  content: '\n\n---\n\n',
                })
              )
            );
          } else if (phase === 'auto-challenge') {
            safeEnqueue(
              ssePayload(
                makeChunk(responseId, modelLabel, {
                  content: '\n\n---\n\n### 🔍 互相挑刺\n\n',
                })
              )
            );
          } else if (phase === 'voting') {
            safeEnqueue(
              ssePayload(
                makeChunk(responseId, modelLabel, {
                  content: '\n\n---\n\n### 🗳️ 多模型投票\n\n',
                })
              )
            );
          } else if (phase === 'user-opinion') {
            safeEnqueue(
              ssePayload(
                makeChunk(responseId, modelLabel, {
                  content: '\n\n---\n\n### 用户意见评审\n\n',
                })
              )
            );
          }
        } else if (!passthrough && event.type === 'challenge') {
          const { challenge } = event.data as { challenge: import('@/lib/types').Challenge };
          safeEnqueue(
            ssePayload(makeChunk(responseId, modelLabel, { content: formatChallengeLine(challenge) }))
          );
        } else if (!passthrough && event.type === 'deliberation-result') {
          const { result } = event.data as {
            result: import('@/lib/types').StructuredDeliberationResult;
          };
          safeEnqueue(
            ssePayload(makeChunk(responseId, modelLabel, { content: formatStructuredDeliberationBlock(result) }))
          );
        } else if (!passthrough && event.type === 'voting-result') {
          const { result } = event.data as {
            result: import('@/lib/types').VotingResult;
          };
          safeEnqueue(
            ssePayload(makeChunk(responseId, modelLabel, { content: formatVotingBlock(result) }))
          );
        } else if (!passthrough && event.type === 'user-opinion-result') {
          const { result } = event.data as {
            result: import('@/lib/types').UserOpinionResult;
          };
          safeEnqueue(
            ssePayload(makeChunk(responseId, modelLabel, { content: formatUserOpinionBlock(result) }))
          );
        } else if (event.type === 'run-complete') {
          const { result } = event.data as RunCompleteEventData;
          if (!passthrough) {
            safeEnqueue(
              ssePayload(
                makeChunk(responseId, modelLabel, {
                  content: `\n\n---\n\n${formatProtocolBlock(result.protocolOutput)}`,
                })
              )
            );
          }
          // 透传：标准 OpenAI finish chunk，不带 x_adversarial
          // 对抗模式：最后一个 chunk 含完整 adversarial 元数据
          const finalChunk: OpenAIChunk & { x_adversarial?: unknown } = passthrough
            ? makeChunk(responseId, modelLabel, {}, 'stop')
            : {
                ...makeChunk(responseId, modelLabel, {}, 'stop'),
                x_adversarial: {
                  runId: result.runId,
                  durationMs: result.durationMs,
                  responses: result.responses.map(r => ({
                    modelId: r.modelId,
                    content: r.content,
                    tokensIn: r.tokensIn,
                    tokensOut: r.tokensOut,
                    durationMs: r.durationMs,
                    error: r.error,
                  })),
                  challenges: result.challenges,
                  structuredDeliberation: result.structuredDeliberation,
                  voting: result.voting,
                  userOpinion: result.userOpinion,
                  protocolOutput: result.protocolOutput,
                  metrics: result.metrics,
                },
              };
          safeEnqueue(ssePayload(finalChunk));
          safeEnqueue(SSE_DONE);
          closeStream();
        } else if (event.type === 'run-failed') {
          const { error } = event.data as RunFailedEventData;
          const errChunk = {
            ...makeChunk(responseId, modelLabel, { content: `\n\n[ERROR] ${error}` }, 'stop'),
            x_adversarial_error: error,
          };
          safeEnqueue(ssePayload(errChunk));
          safeEnqueue(SSE_DONE);
          closeStream();
        }
        // model-complete: 不必单独发送，chunk 已经累积过
      };

      unsubscribe = hub.subscribeRun(runId, onEvent);
    },
    cancel() {
      // Client disconnected (e.g. curl Ctrl+C, fetch abort).
      closed = true;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    },
  });
}

/**
 * Anthropic Messages 兼容的 SSE 流
 */
export function buildAnthropicStream(
  hub: EngineHub,
  request: { runId: string; modelLabel: string; question: string; passthrough?: boolean }
): ReadableStream<Uint8Array> {
  const { runId, modelLabel, passthrough = false } = request;
  const messageId = `msg_${runId}`;
  let started = false;
  let unsubscribe: (() => void) | null = null;
  let closed = false;
  const modelHeaders = new Set<string>();

  function eventFrame(eventType: string, data: unknown): Uint8Array {
    return enc.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (data: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(data);
        } catch {
          closed = true;
        }
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      };

      const sendDelta = (text: string) => {
        safeEnqueue(
          eventFrame('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text },
          })
        );
      };

      const onEvent = (e: EngineEvent) => {
        if (closed) return;

        if (!started) {
          started = true;
          safeEnqueue(
            eventFrame('message_start', {
              type: 'message_start',
              message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                model: modelLabel,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            })
          );
          safeEnqueue(
            eventFrame('content_block_start', {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            })
          );
        }

        if (e.type === 'chunk') {
          const data = e.data as ChunkEventData;
          if (!passthrough && !modelHeaders.has(data.modelId)) {
            modelHeaders.add(data.modelId);
            sendDelta(`\n\n## ${data.modelId}\n\n`);
          }
          sendDelta(data.delta);
        } else if (!passthrough && e.type === 'phase-change') {
          const { phase } = e.data as { phase: string };
          if (phase === 'deliberation') sendDelta('\n\n---\n\n');
          if (phase === 'auto-challenge') sendDelta('\n\n---\n\n### 🔍 互相挑刺\n\n');
          if (phase === 'voting') sendDelta('\n\n---\n\n### 🗳️ 多模型投票\n\n');
          if (phase === 'user-opinion') sendDelta('\n\n---\n\n### 用户意见评审\n\n');
        } else if (!passthrough && e.type === 'challenge') {
          const { challenge } = e.data as { challenge: import('@/lib/types').Challenge };
          sendDelta(formatChallengeLine(challenge));
        } else if (!passthrough && e.type === 'deliberation-result') {
          const { result } = e.data as {
            result: import('@/lib/types').StructuredDeliberationResult;
          };
          sendDelta(formatStructuredDeliberationBlock(result));
        } else if (!passthrough && e.type === 'voting-result') {
          const { result } = e.data as {
            result: import('@/lib/types').VotingResult;
          };
          sendDelta(formatVotingBlock(result));
        } else if (!passthrough && e.type === 'user-opinion-result') {
          const { result } = e.data as {
            result: import('@/lib/types').UserOpinionResult;
          };
          sendDelta(formatUserOpinionBlock(result));
        } else if (e.type === 'run-complete') {
          const { result } = e.data as RunCompleteEventData;
          if (!passthrough) sendDelta(`\n\n---\n\n${formatProtocolBlock(result.protocolOutput)}`);
          safeEnqueue(eventFrame('content_block_stop', { type: 'content_block_stop', index: 0 }));
          safeEnqueue(
            eventFrame('message_delta', {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: {
                output_tokens: result.responses.reduce((s, r) => s + r.tokensOut, 0),
              },
            })
          );
          safeEnqueue(eventFrame('message_stop', { type: 'message_stop' }));
          closeStream();
        } else if (e.type === 'run-failed') {
          const { error } = e.data as RunFailedEventData;
          sendDelta(`\n\n[ERROR] ${error}`);
          safeEnqueue(eventFrame('content_block_stop', { type: 'content_block_stop', index: 0 }));
          safeEnqueue(eventFrame('message_stop', { type: 'message_stop' }));
          closeStream();
        }
      };

      unsubscribe = hub.subscribeRun(runId, onEvent);
    },
    cancel() {
      closed = true;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    },
  });
}
