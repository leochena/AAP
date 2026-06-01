/**
 * Anthropic Messages API 兼容路由
 */

import { Hono } from 'hono';
import { Context } from 'hono';
import { stream } from 'hono/streaming';
import { EngineHub } from '@/engine/EngineHub';
import { Message, RunRequest, RunResult, UserOpinionInput } from '@/lib/types';
import { buildAnthropicStream } from '@/server/sse';
import { formatUserOpinionResult, normalizeUserOpinionInput } from '@/lib/features/user-opinion';
import { formatProtocolOutputContract } from '@/lib/features/output-contract';
import { formatStructuredDeliberation } from '@/lib/features/structured-deliberation';

interface AnthropicRequest {
  model: string;
  messages: Array<{ role: string; content: string | Array<{ type: string; text: string }> }>;
  system?: string;
  stream?: boolean;
  max_tokens?: number;
  user_opinion?: string | UserOpinionInput;
  user_evidence?: string[];
  x_adversarial?: {
    user_opinion?: string | UserOpinionInput;
    user_evidence?: string[];
  };
}

export function createAnthropicRoutes(hub: EngineHub): Hono {
  const app = new Hono();

  app.post('/v1/messages', async (c: Context) => {
    let body: AnthropicRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON' } }, 400);
    }

    if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json(
        {
          type: 'error',
          error: { type: 'invalid_request_error', message: 'model and messages are required' },
        },
        400
      );
    }

    const parsed = parseModelField(body.model);
    if (!parsed) {
      return c.json(
        { type: 'error', error: { type: 'invalid_request_error', message: `Invalid model: ${body.model}` } },
        400
      );
    }

    const messages = normalizeAnthropicMessages(body.messages, body.system);
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) {
      return c.json(
        { type: 'error', error: { type: 'invalid_request_error', message: 'No user message' } },
        400
      );
    }
    const history = messages.slice(0, messages.lastIndexOf(lastUser));
    const userOpinion = parseUserOpinion(body);

    const runRequest: RunRequest = {
      question: lastUser.content,
      history,
      modelIds: parsed.modelIds,
      source: 'http-anthropic',
      enableAutoChallenge: parsed.mode !== 'passthrough',
      enableVoting: parsed.mode !== 'passthrough',
      userOpinion,
    };

    let started: ReturnType<EngineHub['startRun']>;
    try {
      started = hub.startRun(runRequest);
    } catch (err) {
      return c.json(
        {
          type: 'error',
          error: { type: 'invalid_request_error', message: err instanceof Error ? err.message : String(err) },
        },
        400
      );
    }

    if (body.stream) {
      const sseStream = buildAnthropicStream(hub, {
        runId: started.runId,
        modelLabel: body.model,
        question: lastUser.content,
        passthrough: parsed.mode === 'passthrough',
      });
      started.promise.catch(() => {});

      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');
      return stream(c, async stream => {
        const reader = sseStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await stream.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      });
    }

    let result: RunResult;
    try {
      result = await started.promise;
    } catch (err) {
      return c.json(
        {
          type: 'error',
          error: { type: 'api_error', message: err instanceof Error ? err.message : String(err) },
        },
        500
      );
    }

    const finalContent = composeFinalContent(parsed.mode, result);
    const base: Record<string, unknown> = {
      id: `msg_${result.runId}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: finalContent }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: result.responses.reduce((s, r) => s + r.tokensIn, 0),
        output_tokens: result.responses.reduce((s, r) => s + r.tokensOut, 0),
      },
    };

    // 透传模式：返回干净的 Anthropic 响应
    if (parsed.mode === 'passthrough') return c.json(base);

    base.x_adversarial = {
      runId: result.runId,
      durationMs: result.durationMs,
      mode: parsed.mode,
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
    };
    return c.json(base);
  });

  return app;
}

interface ParsedModel {
  mode: 'all' | 'vote' | 'debate' | 'specific' | 'passthrough';
  modelIds: string[];
}

function parseModelField(raw: string): ParsedModel | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('adversarial:')) {
    return { mode: 'passthrough', modelIds: [trimmed] };
  }
  const rest = trimmed.slice('adversarial:'.length).trim();
  if (rest === 'all' || rest === '') return { mode: 'all', modelIds: [] };
  if (rest === 'vote') return { mode: 'vote', modelIds: [] };
  if (rest === 'debate') return { mode: 'debate', modelIds: [] };
  const ids = rest.split(',').map(s => s.trim()).filter(Boolean);
  return ids.length > 0 ? { mode: 'specific', modelIds: ids } : null;
}

function normalizeAnthropicMessages(
  raw: AnthropicRequest['messages'],
  system?: string
): Message[] {
  const out: Message[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of raw) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content =
      typeof m.content === 'string'
        ? m.content
        : m.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('');
    out.push({ role, content });
  }
  return out;
}

function composeFinalContent(mode: ParsedModel['mode'], result: RunResult): string {
  if (mode === 'passthrough') {
    return result.responses[0]?.content ?? '';
  }
  let out = '';
  if (mode === 'vote' && result.voting?.winner) {
    const winnerResp = result.responses.find(r => r.modelId === result.voting!.winner);
    if (winnerResp) {
      out +=
        `# 投票获胜模型: ${winnerResp.modelId}\n` +
        `共识度: ${(result.voting!.consensusLevel * 100).toFixed(1)}%\n\n` +
        `${winnerResp.content}\n`;
    }
  }
  if (!out) {
    for (const r of result.responses) {
      out += `## ${r.modelId}\n\n`;
      out += r.error ? `[ERROR] ${r.error}\n\n` : `${r.content}\n\n`;
    }
  }
  const deliberationBlock = formatStructuredDeliberation(result.structuredDeliberation);
  if (deliberationBlock) {
    out += `\n\n---\n\n${deliberationBlock}\n`;
  }
  if (result.challenges.length > 0) {
    out += '\n---\n\n## 🔍 互相挑刺\n\n';
    for (const c of result.challenges) {
      out += `- **${c.challengerId}** → **${c.targetId}** [${c.severity}] ${c.type}: ${c.reason}\n`;
    }
  }
  const userOpinionBlock = formatUserOpinionResult(result.userOpinion);
  if (userOpinionBlock) {
    out += `\n\n---\n\n${userOpinionBlock}\n`;
  }
  if (result.voting) {
    out += '\n---\n\n## 🗳️ 投票结果\n\n';
    if (result.voting.winner) {
      out += `**获胜:** ${result.voting.winner} (共识度 ${(result.voting.consensusLevel * 100).toFixed(1)}%)\n\n`;
    } else {
      out += '**结果:** 平局\n\n';
    }
  }
  const protocolBlock = formatProtocolOutputContract(result.protocolOutput);
  if (protocolBlock) {
    out += `\n\n---\n\n${protocolBlock}\n`;
  }
  return out.trim();
}

function parseUserOpinion(body: AnthropicRequest): UserOpinionInput | undefined {
  const raw = body.user_opinion ?? body.x_adversarial?.user_opinion;
  const opinion = normalizeUserOpinionInput(raw);
  const evidence = body.user_evidence ?? body.x_adversarial?.user_evidence;
  if (!opinion && (!evidence || evidence.length === 0)) return undefined;
  return {
    text: opinion?.text ?? '用户提供了证据链接，请核验这些证据是否支持最终结论。',
    evidenceUrls: [...(opinion?.evidenceUrls ?? []), ...(evidence ?? [])],
  };
}
