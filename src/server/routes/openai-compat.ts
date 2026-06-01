/**
 * OpenAI Chat Completions 兼容路由
 *
 * 支持的 model 字段格式：
 *   - "adversarial:all"               → 调用所有 enabled 模型 + 对抗
 *   - "adversarial:vote"              → 同上，但答案返回投票获胜者
 *   - "adversarial:debate"            → 同上，但答案返回挑刺汇总
 *   - "adversarial:m1,m2,m3"          → 仅指定模型参与对抗
 *   - "<modelId>"                     → 直接透传给单一模型（不做对抗）
 */

import { Hono } from 'hono';
import { Context } from 'hono';
import { stream } from 'hono/streaming';
import { EngineHub } from '@/engine/EngineHub';
import { Message, RunRequest, RunResult, UserOpinionInput } from '@/lib/types';
import { buildOpenAIStream } from '@/server/sse';
import { formatUserOpinionResult, normalizeUserOpinionInput } from '@/lib/features/user-opinion';
import { formatProtocolOutputContract } from '@/lib/features/output-contract';
import { formatStructuredDeliberation } from '@/lib/features/structured-deliberation';

interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  user_opinion?: string | UserOpinionInput;
  user_evidence?: string[];
  x_adversarial?: {
    user_opinion?: string | UserOpinionInput;
    user_evidence?: string[];
  };
}

export function createOpenAIRoutes(hub: EngineHub): Hono {
  const app = new Hono();

  app.get('/v1/models', (c: Context) => {
    const config = hub.getConfig();
    const aapModels = config.models.map(m => ({
      id: m.id,
      object: 'model' as const,
      created: 0,
      owned_by: m.protocol,
    }));
    const virtualModels = [
      { id: 'adversarial:all', object: 'model' as const, created: 0, owned_by: 'aap' },
      { id: 'adversarial:vote', object: 'model' as const, created: 0, owned_by: 'aap' },
      { id: 'adversarial:debate', object: 'model' as const, created: 0, owned_by: 'aap' },
    ];
    return c.json({ object: 'list', data: [...virtualModels, ...aapModels] });
  });

  app.post('/v1/chat/completions', async (c: Context) => {
    let body: ChatCompletionRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request' } }, 400);
    }

    if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json(
        { error: { message: 'model and messages are required', type: 'invalid_request' } },
        400
      );
    }

    const parsed = parseModelField(body.model);
    if (!parsed) {
      return c.json({ error: { message: `Invalid model: ${body.model}` } }, 400);
    }

    const messages = normalizeMessages(body.messages);
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) {
      return c.json(
        { error: { message: 'No user message found', type: 'invalid_request' } },
        400
      );
    }

    const history = messages.slice(0, messages.lastIndexOf(lastUser));
    const userOpinion = parseUserOpinion(body);

    const runRequest: RunRequest = {
      question: lastUser.content,
      history,
      modelIds: parsed.modelIds,
      source: 'http-openai',
      enableAutoChallenge: parsed.mode !== 'passthrough',
      enableVoting: parsed.mode !== 'passthrough',
      userOpinion,
    };

    let started: ReturnType<EngineHub['startRun']>;
    try {
      started = hub.startRun(runRequest);
    } catch (err) {
      return c.json(
        { error: { message: err instanceof Error ? err.message : String(err) } },
        400
      );
    }

    if (body.stream) {
      const sseStream = buildOpenAIStream(hub, {
        runId: started.runId,
        modelLabel: body.model,
        question: lastUser.content,
        passthrough: parsed.mode === 'passthrough',
      });
      // 防止 hub 异常时悬挂
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

    // 非流式：等待完成后返回完整结果
    let result: RunResult;
    try {
      result = await started.promise;
    } catch (err) {
      return c.json(
        { error: { message: err instanceof Error ? err.message : String(err) } },
        500
      );
    }
    return c.json(buildOpenAIFinalResponse(body.model, parsed.mode, result));
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
  if (rest === 'all' || rest === '') {
    return { mode: 'all', modelIds: [] };
  }
  if (rest === 'vote') {
    return { mode: 'vote', modelIds: [] };
  }
  if (rest === 'debate') {
    return { mode: 'debate', modelIds: [] };
  }

  // 逗号分隔的模型 ID 列表
  const ids = rest
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (ids.length === 0) return null;
  return { mode: 'specific', modelIds: ids };
}

function normalizeMessages(raw: Array<{ role: string; content: string }>): Message[] {
  return raw.map(m => ({
    role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
}

function buildOpenAIFinalResponse(
  modelLabel: string,
  mode: ParsedModel['mode'],
  result: RunResult
): Record<string, unknown> {
  const finalContent = composeFinalContent(mode, result);
  const tokensIn = result.responses.reduce((s, r) => s + r.tokensIn, 0);
  const tokensOut = result.responses.reduce((s, r) => s + r.tokensOut, 0);

  const base: Record<string, unknown> = {
    id: `chatcmpl-${result.runId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelLabel,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: finalContent },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: tokensIn,
      completion_tokens: tokensOut,
      total_tokens: tokensIn + tokensOut,
    },
  };

  // 透传模式：返回干净的 OpenAI 响应，不附加 x_adversarial
  if (mode === 'passthrough') return base;

  base.x_adversarial = {
    runId: result.runId,
    durationMs: result.durationMs,
    mode,
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
  return base;
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
        `共识度: ${((result.voting!.consensusLevel) * 100).toFixed(1)}%\n\n` +
        `${winnerResp.content}\n`;
    }
  }

  if (!out) {
    // 默认 / debate / all：合并展示
    for (const r of result.responses) {
      out += `## ${r.modelId}\n\n`;
      if (r.error) {
        out += `[ERROR] ${r.error}\n\n`;
      } else {
        out += `${r.content}\n\n`;
      }
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
    out += '**得票:**\n';
    for (const [id, score] of Object.entries(result.voting.totals)) {
      out += `- ${id}: ${score.toFixed(2)}\n`;
    }
  }
  const protocolBlock = formatProtocolOutputContract(result.protocolOutput);
  if (protocolBlock) {
    out += `\n\n---\n\n${protocolBlock}\n`;
  }
  return out.trim();
}

function parseUserOpinion(body: ChatCompletionRequest): UserOpinionInput | undefined {
  const raw = body.user_opinion ?? body.x_adversarial?.user_opinion;
  const opinion = normalizeUserOpinionInput(raw);
  const evidence = body.user_evidence ?? body.x_adversarial?.user_evidence;
  if (!opinion && (!evidence || evidence.length === 0)) return undefined;
  return {
    text: opinion?.text ?? '用户提供了证据链接，请核验这些证据是否支持最终结论。',
    evidenceUrls: [...(opinion?.evidenceUrls ?? []), ...(evidence ?? [])],
  };
}
