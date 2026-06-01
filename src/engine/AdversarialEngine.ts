/**
 * AdversarialEngine - 单次对抗运行的引擎
 *
 * 一个 run 包含三个阶段：
 *   1. generating  — 并行调用所有模型流式生成答案
 *   2. auto-challenge — 模型互相挑刺（可选）
 *   3. voting       — 模型对结果投票（可选）
 *
 * 通过 EventEmitter 推送事件给订阅者（TUI / SSE）。
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  AdversarialConfig,
  Challenge,
  ChunkEventData,
  EngineEvent,
  EngineEventType,
  Message,
  ModelConfig,
  ModelResponse,
  RunRequest,
  RunResult,
  RunSnapshot,
  Vote,
  VotingResult,
  AuditMetrics,
  UserClaim,
  UserClaimAssessment,
  UserOpinionResult,
} from '@/lib/types';
import { streamModel, callModelNonStream } from '@/engine/ModelClient';
import { streamWithTools } from '@/lib/clients/openai-tool-loop';
import { ToolRegistry } from '@/lib/tools/registry';
import { searchToolDef, makeSearchHandler } from '@/lib/tools/search';
import { fetchUrlToolDef, makeFetchUrlHandler } from '@/lib/tools/fetch';
import { execPythonToolDef, makeExecPythonHandler } from '@/lib/tools/code-exec';
import {
  concedeToolDef,
  makeConcedeHandler,
  InMemoryConcessionTracker,
  ConcessionTracker,
} from '@/lib/tools/concede';
import { getCapability, setCapability } from '@/engine/capability-cache';
import { probeToolCalling } from '@/engine/capability-probe';
import {
  generateAutoChallengePrompt,
  parseChallengeResponse,
  deduplicateChallenges,
  limitChallenges,
} from '@/lib/features/auto-challenge';
import {
  generateVotingPrompt,
  parseVotingResponse,
  calculateVotingResult,
} from '@/lib/features/voting';
import {
  recordMessage,
  recordChallenge,
  getMetrics,
  updateMetrics,
} from '@/lib/features/audit-metrics';
import {
  buildUserOpinionResult,
  extractUserClaims,
  formatUserOpinionResult,
  generateUserClaimReviewPrompt,
  parseUserClaimAssessmentResponse,
} from '@/lib/features/user-opinion';

export interface AdversarialEngineOptions {
  request: RunRequest;
  models: ModelConfig[];                 // 已根据 request.modelIds 解析好的模型
  adversarialConfig: AdversarialConfig;
  storageDir: string;
  signal?: AbortSignal;
}

export class AdversarialEngine extends EventEmitter {
  readonly runId: string;
  readonly snapshot: RunSnapshot;
  private readonly modelMap: Map<string, ModelConfig>;
  private readonly options: AdversarialEngineOptions;
  private toolsActive: boolean;
  private readonly toolRegistry?: ToolRegistry;
  private readonly concessions: ConcessionTracker;

  constructor(options: AdversarialEngineOptions) {
    super();
    this.runId = randomUUID();
    this.options = options;
    this.modelMap = new Map(options.models.map(m => [m.id, m]));
    this.snapshot = {
      runId: this.runId,
      source: options.request.source,
      request: options.request,
      phase: 'pending',
      responses: {},
      challenges: [],
      startedAt: Date.now(),
    };

    this.toolsActive =
      (options.request.useTools ?? options.adversarialConfig.tools?.enabled) === true;
    this.concessions = new InMemoryConcessionTracker();

    if (this.toolsActive) {
      this.toolRegistry = this.buildToolRegistry();
    }
  }

  private buildToolRegistry(): ToolRegistry {
    const cfg = this.options.adversarialConfig.tools;
    const reg = new ToolRegistry();

    reg.register(
      searchToolDef,
      makeSearchHandler({ baseUrl: cfg.searxngUrl, engines: cfg.searchEngines })
    );
    if (cfg.fetchUrl.enabled) {
      reg.register(
        fetchUrlToolDef,
        makeFetchUrlHandler({ maxBytes: cfg.fetchUrl.maxBytes, timeoutMs: cfg.fetchUrl.timeoutMs })
      );
    }
    if (cfg.codeExec.enabled) {
      reg.register(
        execPythonToolDef,
        makeExecPythonHandler({
          image: cfg.codeExec.image,
          timeoutMs: cfg.codeExec.timeoutMs,
          memoryMb: cfg.codeExec.memoryMb,
          cpus: cfg.codeExec.cpus,
          wslDistro: cfg.codeExec.wslDistro,
        })
      );
    }
    if (cfg.concede.enabled) {
      reg.register(concedeToolDef, makeConcedeHandler(this.concessions));
    }
    return reg;
  }

  private async applyCapabilityFiltering(): Promise<void> {
    const cfg = this.options.adversarialConfig.tools;
    const ttl = cfg.capabilityCacheHours;
    const storage = this.options.storageDir;
    const keep: ModelConfig[] = [];
    const dropped: { id: string; reason: string }[] = [];

    for (const model of this.options.models) {
      if (model.toolCallingSupport === 'yes') {
        keep.push(model);
        continue;
      }
      if (model.toolCallingSupport === 'no') {
        dropped.push({ id: model.id, reason: 'config: toolCallingSupport=no' });
        continue;
      }
      // 走缓存或现场探测
      let cached = getCapability(storage, model.id, ttl);
      if (!cached) {
        const result = await probeToolCalling(model);
        setCapability(storage, model.id, result);
        cached = result;
      }
      if (cached.supported) {
        keep.push(model);
      } else {
        dropped.push({ id: model.id, reason: cached.reason });
      }
    }

    if (dropped.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[run ${this.runId}] tools enabled — dropped ${dropped.length} model(s) without tool-calling support: ` +
          dropped.map(d => `${d.id} (${d.reason})`).join('; ')
      );
    }

    if (keep.length < 2) {
      // eslint-disable-next-line no-console
      console.warn(
        `[run ${this.runId}] only ${keep.length} model(s) support tool-calling; falling back to text-only mode`
      );
      this.toolsActive = false;
      return;
    }

    (this.options as { models: ModelConfig[] }).models = keep;
    this.modelMap.clear();
    for (const m of keep) this.modelMap.set(m.id, m);
  }

  private emitEvent(type: EngineEventType, data: unknown) {
    const event: EngineEvent = {
      runId: this.runId,
      type,
      timestamp: Date.now(),
      data,
    };
    this.emit('event', event);
    this.emit(type, data);
  }

  async run(): Promise<RunResult> {
    const start = Date.now();
    const maxRounds = Math.max(
      1,
      this.options.request.maxRounds ?? this.options.adversarialConfig.maxRounds ?? 1
    );
    this.snapshot.totalRounds = maxRounds;

    try {
      this.snapshot.phase = 'pending';
      this.emitEvent('run-start', { request: this.options.request, models: this.options.models });

      // ==== 工具能力过滤 ====
      // 启用 tools 时，剔除不支持 tool-calling 的模型；只剩 < 2 个则放弃工具模式。
      if (this.toolsActive) {
        await this.applyCapabilityFiltering();
      }

      let responses: ModelResponse[] = [];
      let blindResponses: ModelResponse[] = [];
      let challenges: Challenge[] = [];
      const enableAC =
        this.options.request.enableAutoChallenge ??
        this.options.adversarialConfig.autoChallenge.enabled;

      for (let round = 1; round <= maxRounds; round++) {
        this.snapshot.currentRound = round;
        this.emitEvent('round-start', { round, totalRounds: maxRounds });

        // ==== Phase: Generating ====
        this.snapshot.phase = 'generating';
        this.emitEvent('phase-change', { phase: 'generating' });

        const prior = round > 1 ? { responses, challenges } : undefined;
        responses = await this.runGenerating(prior);
        if (round === 1) {
          blindResponses = responses;
        }
        // Snapshot reflects the latest round only.
        this.snapshot.responses = {};
        responses.forEach(r => {
          this.snapshot.responses[r.modelId] = r;
        });

        // ==== Phase: Auto-Challenge ====
        // Run challenges every round so round n+1 can refine off them.
        // On the final round we still record them so the UI can show them.
        if (enableAC && responses.filter(r => !r.error).length >= 2) {
          this.snapshot.phase = 'auto-challenge';
          this.emitEvent('phase-change', { phase: 'auto-challenge' });
          challenges = await this.runAutoChallenge(responses);
          this.snapshot.challenges = challenges;
        } else {
          challenges = [];
          this.snapshot.challenges = [];
        }
      }

      // ==== Phase: User Opinion Review ====
      let userOpinion: UserOpinionResult | undefined;
      if (this.options.request.userOpinion) {
        this.snapshot.phase = 'user-opinion';
        this.emitEvent('phase-change', { phase: 'user-opinion' });
        userOpinion = await this.runUserOpinionReview(blindResponses, responses);
        this.snapshot.userOpinion = userOpinion;
        this.emitEvent('user-opinion-result', { result: userOpinion });
      }

      // ==== Phase: Voting (only on final round responses) ====
      const enableV =
        this.options.request.enableVoting ??
        this.options.adversarialConfig.voting.enabled;
      let voting: VotingResult | undefined;
      if (enableV && responses.filter(r => !r.error).length >= 2) {
        this.snapshot.phase = 'voting';
        this.emitEvent('phase-change', { phase: 'voting' });
        voting = await this.runVoting(responses);
        this.snapshot.voting = voting;
      }

      // ==== Audit Metrics ====
      const metrics = this.computeAuditMetrics(responses, this.snapshot.challenges);

      this.snapshot.phase = 'complete';
      this.snapshot.finishedAt = Date.now();
      this.emitEvent('phase-change', { phase: 'complete' });

      const result: RunResult = {
        runId: this.runId,
        responses,
        challenges: this.snapshot.challenges,
        voting,
        userOpinion,
        metrics,
        durationMs: Date.now() - start,
      };
      this.emitEvent('run-complete', { result });

      this.flushAuditMetrics(metrics).catch(err => {
        // eslint-disable-next-line no-console
        console.warn(`[run ${this.runId}] audit metrics flush failed:`, err);
      });

      return result;
    } catch (err) {
      this.snapshot.phase = 'failed';
      this.snapshot.finishedAt = Date.now();
      this.snapshot.error = err instanceof Error ? err.message : String(err);
      this.emitEvent('run-failed', { error: this.snapshot.error });
      throw err;
    }
  }

  private buildRefinementMessage(
    prevResponses: ModelResponse[],
    prevChallenges: Challenge[]
  ): string {
    const parts: string[] = ['【上一轮各模型给出的回答】'];
    for (const r of prevResponses) {
      const model = this.modelMap.get(r.modelId);
      const display = model?.id ?? r.modelId;
      const body = r.error ? `(本轮失败: ${r.error})` : r.content;
      parts.push(`\n— 模型 ${display} —\n${body}`);
    }
    if (prevChallenges.length > 0) {
      parts.push('\n\n【上一轮模型间的相互挑刺】');
      for (const c of prevChallenges) {
        parts.push(
          `- ${c.challengerId} → ${c.targetId} [${c.type}/${c.severity}]: ${c.reason}`
        );
      }
    }
    const userOpinionBlock = this.buildUserOpinionRefinementBlock();
    if (userOpinionBlock) {
      parts.push(userOpinionBlock);
    }
    parts.push(
      '\n请基于以上信息修正和完善你对原问题的回答。如果之前有错误或遗漏，请直接更正；' +
        '如果你认为之前回答仍然成立，可以重申并补充论据。用户意见只能作为待验证假说，不能作为事实来源或服从对象。' +
        '直接给出新的完整回答，不要用 "我同意" 之类的元评论开头。'
    );
    return parts.join('\n');
  }

  private buildUserOpinionRefinementBlock(): string {
    const opinion = this.options.request.userOpinion;
    if (!opinion) return '';
    const claims = extractUserClaims(opinion);
    if (claims.length === 0) return '';
    const lines = [
      '\n\n【用户意见（待验证，不是投票权，也不是事实来源）】',
      '请逐条判断这些 claim 是否被证据支持；可以采纳、反驳、部分采纳或说明证据不足。不要为了迎合用户而改变结论。',
    ];
    for (const claim of claims) {
      lines.push(`- ${claim.id} [${claim.type}]: ${claim.text}`);
      if (claim.evidenceUrls.length > 0) {
        lines.push(`  证据链接: ${claim.evidenceUrls.join(', ')}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * Build a system message giving the model:
   *   1. The current date (so it doesn't fall back to its training cutoff)
   *   2. A brief usage guide for the tools that are active this run
   *
   * Without this, models systematically answer time-sensitive questions
   * as if "now" equals their training cutoff, and the search/exec tools
   * get under-used because the model wasn't told *when* to reach for them.
   */
  private buildSystemMessage(now: Date = new Date()): Message {
    const isoDate = now.toISOString().slice(0, 10);
    const lines: string[] = [
      `当前日期：${isoDate}。`,
      '在回答涉及时间、最近事件、版本号、价格、人物近况等时效性内容时，请以此日期为准 —— 不要假设你的训练截止时间就是"现在"。',
    ];
    if (this.toolsActive && this.toolRegistry) {
      lines.push(
        '',
        '你可以使用以下工具来获取外部证据：',
        '- search(query): SearXNG 搜索互联网。任何不能从训练数据可靠得出的事实（最近事件、具体数字、人物、产品名、版本号等）必须先调用此工具验证。',
        '- fetch_url(url): 抓取并返回 URL 内容，用来验证你回忆中的链接是否真实存在。',
        '- exec_python(code): 在隔离沙箱执行 Python 代码。任何数值计算、单位换算、数据处理必须用此工具，比口算可靠。',
        '- concede(reason, defer_to?): 当工具结果显示你之前的判断错了，主动调用此工具承认错误并退出本次评估。诚实认错是高荣誉信号 —— 比硬撑或编造好得多。',
        '',
        '原则：**求真 > 给出听起来完整的答案**。如果工具结果显示证据不足，请明确说"基于现有证据无法确定"或调用 concede 退出，**不要编造工具调用结果或想象不存在的资料**。'
      );
    }
    return { role: 'system', content: lines.join('\n') };
  }

  private async runGenerating(
    prior?: { responses: ModelResponse[]; challenges: Challenge[] }
  ): Promise<ModelResponse[]> {
    const { request, models, signal } = this.options;
    const baseMessages: Message[] = [
      this.buildSystemMessage(),
      ...(request.history ?? []),
      { role: 'user', content: request.question },
    ];
    const messages: Message[] = prior
      ? [
          ...baseMessages,
          {
            role: 'user',
            content: this.buildRefinementMessage(prior.responses, prior.challenges),
          },
        ]
      : baseMessages;

    const useTools = this.toolsActive && this.toolRegistry !== undefined;

    return Promise.all(
      models.map(async model => {
        // 已退出模型不参与新一轮
        if (this.concessions.isWithdrawn(model.id)) {
          return {
            modelId: model.id,
            content: '(已退出本次评估)',
            tokensIn: 0,
            tokensOut: 0,
            durationMs: 0,
            withdrawn: true,
            withdrawnReason: '主动认错退出',
          } as ModelResponse;
        }

        const start = Date.now();
        let contentSoFar = '';
        const onDelta = (delta: string) => {
          contentSoFar += delta;
          const data: ChunkEventData = {
            modelId: model.id,
            delta,
            contentSoFar,
          };
          this.emitEvent('chunk', data);
        };

        try {
          if (useTools && model.protocol === 'openai') {
            const result = await streamWithTools({
              model,
              messages,
              tools: this.toolRegistry!.list(),
              registry: this.toolRegistry!,
              ctx: { modelId: model.id, runId: this.runId, signal },
              signal,
              maxIterations: this.options.adversarialConfig.tools.maxToolCallsPerGeneration,
              onDelta,
              onToolCall: (call, dispatched) => {
                this.emitEvent('tool-call', {
                  modelId: model.id,
                  toolName: call.name,
                  ok: dispatched.ok,
                  preview: ((dispatched.content ?? dispatched.error) ?? '').slice(0, 200),
                });
              },
              isWithdrawn: () => this.concessions.isWithdrawn(model.id),
            });
            const conc = this.concessions.list().find(c => c.modelId === model.id);
            const resp: ModelResponse = {
              modelId: model.id,
              content: result.content,
              tokensIn: result.tokensIn,
              tokensOut: result.tokensOut,
              durationMs: Date.now() - start,
              toolCalls: result.toolCallsLog.map(c => ({ name: c.name, ok: true })),
              withdrawn: conc !== undefined,
              withdrawnReason: conc?.reason,
              withdrawnDeferTo: conc?.deferTo,
            };
            if (resp.withdrawn) {
              this.emitEvent('model-withdrawn', {
                modelId: model.id,
                reason: resp.withdrawnReason ?? '',
                deferTo: resp.withdrawnDeferTo,
              });
            }
            this.emitEvent('model-complete', { response: resp });
            return resp;
          } else {
            const response = await streamModel({
              model,
              messages,
              signal,
              onDelta,
            });
            this.emitEvent('model-complete', { response });
            return response;
          }
        } catch (err) {
          const resp: ModelResponse = {
            modelId: model.id,
            content: contentSoFar,
            tokensIn: 0,
            tokensOut: 0,
            durationMs: Date.now() - start,
            error: err instanceof Error ? err.message : String(err),
          };
          this.emitEvent('model-complete', { response: resp });
          return resp;
        }
      })
    );
  }

  private async runAutoChallenge(responses: ModelResponse[]): Promise<Challenge[]> {
    const succeeded = responses.filter(r => !r.error && r.content);
    if (succeeded.length < 2) return [];

    const maxPerRound = this.options.adversarialConfig.autoChallenge.maxChallengesPerRound;

    // 每个模型 → 审计其他每个模型
    const tasks: Promise<Challenge[]>[] = [];
    for (const challenger of succeeded) {
      const challengerModel = this.modelMap.get(challenger.modelId);
      if (!challengerModel) continue;
      for (const target of succeeded) {
        if (target.modelId === challenger.modelId) continue;
        tasks.push(
          this.singleChallenge(challengerModel, challenger.modelId, target).catch(err => {
            // eslint-disable-next-line no-console
            console.warn(
              `[run ${this.runId}] challenge ${challenger.modelId} → ${target.modelId} failed:`,
              err instanceof Error ? err.message : err
            );
            return [] as Challenge[];
          })
        );
      }
    }

    const all = (await Promise.all(tasks)).flat();
    const dedup = deduplicateChallenges(all);
    const limited = limitChallenges(dedup, maxPerRound * succeeded.length);
    limited.forEach(c => this.emitEvent('challenge', { challenge: c }));
    return limited;
  }

  private async singleChallenge(
    challengerModel: ModelConfig,
    challengerId: string,
    target: ModelResponse
  ): Promise<Challenge[]> {
    const targetModel = this.modelMap.get(target.modelId);
    const targetDisplay = targetModel?.id ?? target.modelId;
    const prompt = generateAutoChallengePrompt({
      targetContent: target.content,
      targetDisplayName: targetDisplay,
    });

    const messages: Message[] = [{ role: 'user', content: prompt }];
    const result = await callModelNonStream(challengerModel, messages, {
      signal: this.options.signal,
      maxTokens: 2048,
    });

    const parsed = parseChallengeResponse(result.content, {
      challengerId,
      targetId: target.modelId,
      threshold: this.options.adversarialConfig.autoChallenge.threshold,
    });
    if (parsed.error) {
      // eslint-disable-next-line no-console
      console.warn(
        `[run ${this.runId}] challenge response from ${challengerId} unparseable:`,
        parsed.error
      );
    }
    return parsed.challenges;
  }

  private async runVoting(responses: ModelResponse[]): Promise<VotingResult> {
    // 候选 = 未失败 + 未退出
    const candidates = responses.filter(r => !r.error && r.content && !r.withdrawn);
    const candidateIds = candidates.map(r => r.modelId);
    if (candidateIds.length < 2) {
      return {
        votes: [],
        totals: {},
        consensusLevel: 0,
        isTie: false,
        isUnanimous: false,
        requiresReview: true,
      };
    }

    const concessionList = this.concessions.list();
    const concessionNote = concessionList.length > 0
      ? '\n\n【主动认错的模型（不在评选候选中，但他们的诚实表态值得肯定）】\n' +
        concessionList.map(c => `- ${c.modelId}: ${c.reason}${c.deferTo ? ` (defer→${c.deferTo})` : ''}`).join('\n')
      : '';

    const basePrompt = generateVotingPrompt({
      question: this.options.request.question,
      candidates,
      candidateModels: this.modelMap,
    });
    const userOpinionNote = this.snapshot.userOpinion
      ? '\n\n【用户意见评审结果（用户意见没有投票权，仅作为已审计 claim 参考）】\n' +
        formatUserOpinionResult(this.snapshot.userOpinion)
      : '';
    const prompt = basePrompt + concessionNote + userOpinionNote;

    // 投票者 = 全部未失败的（包括 withdrawn —— 他们承认错了但仍可作为评判者投别人）
    const voters = responses.filter(r => !r.error);

    const tasks = voters.map(async r => {
      const voterModel = this.modelMap.get(r.modelId);
      if (!voterModel) return null;
      try {
        const result = await callModelNonStream(
          voterModel,
          [{ role: 'user', content: prompt }],
          { signal: this.options.signal, maxTokens: 1024 }
        );
        const parsed = parseVotingResponse(result.content, candidateIds);
        if (!parsed) {
          // eslint-disable-next-line no-console
          console.warn(
            `[run ${this.runId}] vote response from ${r.modelId} unparseable`
          );
          return null;
        }
        const vote: Vote = {
          voterId: r.modelId,
          choice: parsed.choice,
          confidence: parsed.confidence,
          reasoning: parsed.reasoning,
          timestamp: Date.now(),
        };
        return vote;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[run ${this.runId}] vote call from ${r.modelId} failed:`,
          err instanceof Error ? err.message : err
        );
        return null;
      }
    });

    const votes = (await Promise.all(tasks)).filter((v): v is Vote => v !== null);
    const result = calculateVotingResult({
      votes,
      options: candidateIds,
      models: this.modelMap,
      config: this.options.adversarialConfig.voting,
    });
    this.emitEvent('voting-result', { result });
    return result;
  }

  private async runUserOpinionReview(
    blindResponses: ModelResponse[],
    finalResponses: ModelResponse[]
  ): Promise<UserOpinionResult> {
    const opinion = this.options.request.userOpinion;
    if (!opinion) {
      return buildUserOpinionResult({
        opinion: { text: '', evidenceUrls: [] },
        claims: [],
        assessments: [],
        blindResponses,
        finalResponses,
      });
    }

    const claims = extractUserClaims(opinion);
    const assessments = await this.assessUserClaims(claims, blindResponses);
    return buildUserOpinionResult({
      opinion,
      claims,
      assessments,
      blindResponses,
      finalResponses,
    });
  }

  private async assessUserClaims(
    claims: UserClaim[],
    blindResponses: ModelResponse[]
  ): Promise<UserClaimAssessment[]> {
    if (claims.length === 0) return [];
    const voters = this.options.models.filter(m => {
      const blind = blindResponses.find(r => r.modelId === m.id);
      return blind !== undefined && !blind.error;
    });
    const tasks: Promise<UserClaimAssessment | null>[] = [];

    for (const claim of claims) {
      const prompt = generateUserClaimReviewPrompt({
        question: this.options.request.question,
        claim,
        blindResponses,
      });
      for (const model of voters) {
        tasks.push(
          callModelNonStream(
            model,
            [this.buildSystemMessage(), { role: 'user', content: prompt }],
            { signal: this.options.signal, maxTokens: 512 }
          )
            .then(result => {
              const parsed = parseUserClaimAssessmentResponse(result.content);
              if (!parsed) {
                // eslint-disable-next-line no-console
                console.warn(
                  `[run ${this.runId}] user-claim review from ${model.id} unparseable`
                );
                return null;
              }
              return {
                modelId: model.id,
                claimId: claim.id,
                stance: parsed.stance,
                confidence: parsed.confidence,
                reasoning: parsed.reasoning,
                evidenceUsed: parsed.evidenceUsed,
              };
            })
            .catch(err => {
              // eslint-disable-next-line no-console
              console.warn(
                `[run ${this.runId}] user-claim review from ${model.id} failed:`,
                err instanceof Error ? err.message : err
              );
              return null;
            })
        );
      }
    }

    return (await Promise.all(tasks)).filter((a): a is UserClaimAssessment => a !== null);
  }

  private computeAuditMetrics(
    responses: ModelResponse[],
    challenges: Challenge[]
  ): Record<string, AuditMetrics> {
    const result: Record<string, AuditMetrics> = {};
    for (const r of responses) {
      if (r.error) continue;
      let m = getMetrics(r.modelId, this.options.storageDir);
      m = recordMessage(m);
      const targeting = challenges.filter(c => c.targetId === r.modelId);
      for (const c of targeting) m = recordChallenge(m, c);
      result[r.modelId] = m;
    }
    return result;
  }

  private async flushAuditMetrics(
    metrics: Record<string, AuditMetrics>
  ): Promise<void> {
    const writes = Object.entries(metrics).map(([modelId, m]) =>
      updateMetrics(modelId, m, this.options.storageDir)
    );
    await Promise.all(writes);
  }
}
