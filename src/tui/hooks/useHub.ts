/**
 * useHub - 订阅 EngineHub 事件，维护当前所有 run 的 React 状态
 */

import { useEffect, useState } from 'react';
import {
  AppConfig,
  ChunkEventData,
  EngineEvent,
  RunCompleteEventData,
  RunFailedEventData,
  RunSnapshot,
  RunPhase,
  RoundStartEventData,
  ToolCallEventData,
  ModelWithdrawnEventData,
  Challenge,
  VotingResult,
  ModelResponse,
  PhaseChangeEventData,
  UserOpinionResult,
} from '@/lib/types';
import { EngineHub } from '@/engine/EngineHub';

export interface UIToolCall {
  modelId: string;
  toolName: string;
  ok: boolean;
  preview: string;
  timestamp: number;
}

export interface UIWithdrawal {
  modelId: string;
  reason: string;
  deferTo?: string;
}

export interface UIRunState {
  runId: string;
  source: RunSnapshot['source'];
  phase: RunPhase;
  question: string;
  modelIds: string[];
  modelOutputs: Record<string, string>;
  modelDone: Record<string, boolean>;
  modelDuration: Record<string, number>;
  modelTokens: Record<string, number>;
  modelErrors: Record<string, string>;
  challenges: Challenge[];
  userOpinion?: UserOpinionResult;
  voting?: VotingResult;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  currentRound?: number;
  totalRounds?: number;
  toolCalls: UIToolCall[];
  withdrawals: UIWithdrawal[];
}

function emptyRunState(snapshot: RunSnapshot): UIRunState {
  return {
    runId: snapshot.runId,
    source: snapshot.source,
    phase: snapshot.phase,
    question: snapshot.request.question,
    modelIds: snapshot.request.modelIds.filter(id => id !== 'all'),
    modelOutputs: {},
    modelDone: {},
    modelDuration: {},
    modelTokens: {},
    modelErrors: {},
    challenges: [],
    startedAt: snapshot.startedAt,
    toolCalls: [],
    withdrawals: [],
  };
}

export function useHub(hub: EngineHub) {
  const [runs, setRuns] = useState<Record<string, UIRunState>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [config, setConfig] = useState<AppConfig>(() => hub.getConfig());

  useEffect(() => {
    const onConfigChange = (next: AppConfig) => setConfig(next);
    hub.on('config-change', onConfigChange);
    return () => {
      hub.off('config-change', onConfigChange);
    };
  }, [hub]);

  useEffect(() => {
    // Coalesce chunk events: many models streaming with thousands of small
    // tokens cause one setState per delta and re-render the whole tree. Buffer
    // deltas per (runId, modelId) and flush at ~20fps.
    const pendingChunks = new Map<string, Map<string, string>>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimer = null;
      if (pendingChunks.size === 0) return;
      // Snapshot and clear so further chunks during/after setState start a new
      // batch instead of leaking into this one.
      const drained: Array<[string, Array<[string, string]>]> = [];
      for (const [runId, perModel] of pendingChunks) {
        drained.push([runId, [...perModel]]);
      }
      pendingChunks.clear();

      setRuns(prev => {
        const next = { ...prev };
        for (const [runId, entries] of drained) {
          const existing = next[runId];
          if (!existing) continue;
          const merged = { ...existing.modelOutputs };
          for (const [modelId, addition] of entries) {
            merged[modelId] = (merged[modelId] ?? '') + addition;
          }
          next[runId] = { ...existing, modelOutputs: merged };
        }
        return next;
      });
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, 50);
    };

    const handler = (event: EngineEvent) => {
      if (event.type === 'chunk') {
        const data = event.data as ChunkEventData;
        let perRun = pendingChunks.get(event.runId);
        if (!perRun) {
          perRun = new Map();
          pendingChunks.set(event.runId, perRun);
        }
        perRun.set(data.modelId, (perRun.get(data.modelId) ?? '') + data.delta);
        scheduleFlush();
        return;
      }

      // Non-chunk events: drain any pending chunks first so updates apply in
      // order, then process synchronously.
      if (pendingChunks.size > 0) flush();

      setRuns(prev => {
        const existing = prev[event.runId];

        if (event.type === 'run-start') {
          const snapshot = hub.getRun(event.runId);
          if (!snapshot) return prev;
          const data = event.data as { models?: Array<{ id: string }> };
          const fresh = emptyRunState(snapshot);
          fresh.phase = 'generating';
          fresh.modelIds = data.models?.map(model => model.id) ?? fresh.modelIds;
          fresh.modelOutputs = Object.fromEntries(fresh.modelIds.map(modelId => [modelId, '']));
          setOrder(o => (o.includes(event.runId) ? o : [event.runId, ...o].slice(0, 20)));
          return { ...prev, [event.runId]: fresh };
        }

        if (!existing) return prev;
        const next = { ...existing };

        if (event.type === 'phase-change') {
          next.phase = (event.data as PhaseChangeEventData).phase;
        } else if (event.type === 'round-start') {
          const data = event.data as RoundStartEventData;
          next.currentRound = data.round;
          next.totalRounds = data.totalRounds;
          // Reset per-model output for the new round so the user sees the
          // refined answers, not a cumulative blob.
          if (data.round > 1) {
            next.modelOutputs = {};
            next.modelDone = {};
          }
        } else if (event.type === 'tool-call') {
          const data = event.data as ToolCallEventData;
          next.toolCalls = [
            ...next.toolCalls,
            {
              modelId: data.modelId,
              toolName: data.toolName,
              ok: data.ok,
              preview: data.preview,
              timestamp: event.timestamp,
            },
          ];
        } else if (event.type === 'model-withdrawn') {
          const data = event.data as ModelWithdrawnEventData;
          next.withdrawals = [
            ...next.withdrawals,
            { modelId: data.modelId, reason: data.reason, deferTo: data.deferTo },
          ];
        } else if (event.type === 'model-complete') {
          const { response } = event.data as { response: ModelResponse };
          if (!next.modelIds.includes(response.modelId)) {
            next.modelIds = [...next.modelIds, response.modelId];
          }
          next.modelOutputs = {
            ...next.modelOutputs,
            [response.modelId]: next.modelOutputs[response.modelId] || response.content || '',
          };
          next.modelDone = { ...next.modelDone, [response.modelId]: true };
          next.modelDuration = { ...next.modelDuration, [response.modelId]: response.durationMs };
          next.modelTokens = {
            ...next.modelTokens,
            [response.modelId]: response.tokensIn + response.tokensOut,
          };
          if (response.error) {
            next.modelErrors = { ...next.modelErrors, [response.modelId]: response.error };
          }
        } else if (event.type === 'challenge') {
          const { challenge } = event.data as { challenge: Challenge };
          next.challenges = [...next.challenges, challenge];
        } else if (event.type === 'voting-result') {
          next.voting = (event.data as { result: VotingResult }).result;
        } else if (event.type === 'user-opinion-result') {
          next.userOpinion = (event.data as { result: UserOpinionResult }).result;
        } else if (event.type === 'run-complete') {
          const { result } = event.data as RunCompleteEventData;
          next.phase = 'complete';
          next.finishedAt = Date.now();
          next.voting = result.voting ?? next.voting;
          next.userOpinion = result.userOpinion ?? next.userOpinion;
          for (const response of result.responses) {
            if (!next.modelIds.includes(response.modelId)) {
              next.modelIds = [...next.modelIds, response.modelId];
            }
            next.modelOutputs = {
              ...next.modelOutputs,
              [response.modelId]: next.modelOutputs[response.modelId] || response.content || '',
            };
          }
        } else if (event.type === 'run-failed') {
          next.phase = 'failed';
          next.finishedAt = Date.now();
          next.error = (event.data as RunFailedEventData).error;
        }

        return { ...prev, [event.runId]: next };
      });
    };

    hub.on('engine-event', handler);
    return () => {
      hub.off('engine-event', handler);
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    };
  }, [hub]);

  return { runs, order, config };
}
