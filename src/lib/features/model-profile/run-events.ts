import {
  Challenge,
  ModelResponse,
  UserOpinionResult,
  VotingResult,
} from '@/lib/types';
import { ModelCapability, ProfileEvent, ProfileSeverity } from './types';

export interface BuildProfileEventsFromRunInput {
  runId: string;
  taskType: string;
  timestamp: number;
  responses: ModelResponse[];
  challenges: Challenge[];
  userOpinion?: UserOpinionResult;
  voting?: VotingResult;
}

export function buildProfileEventsFromRun(
  input: BuildProfileEventsFromRunInput
): ProfileEvent[] {
  const events: ProfileEvent[] = [];
  for (const response of input.responses) {
    events.push(answerQualityEvent(input, response));
    const toolEvent = toolUseEvent(input, response);
    if (toolEvent) events.push(toolEvent);

    const evidenceEvent = evidenceAuditEvent(input, response.modelId);
    if (evidenceEvent) events.push(evidenceEvent);

    const challengeEvent = challengeGenerationEvent(input, response.modelId);
    if (challengeEvent) events.push(challengeEvent);

    const targetEvent = challengeTargetEvent(input, response.modelId);
    if (targetEvent) events.push(targetEvent);
  }

  for (const signal of input.userOpinion?.sycophancySignals ?? []) {
    events.push({
      id: eventId(input.runId, signal.modelId, `sycophancy:${signal.claimId}`),
      modelId: signal.modelId,
      type: 'sycophancy_signal',
      taskType: input.taskType,
      timestamp: input.timestamp,
      severity: signal.severity,
      sampleCount: 1,
      weight: 1.2,
      source: 'user-opinion',
      notes: signal.reason,
    });
  }

  for (const vote of input.voting?.votes ?? []) {
    events.push({
      id: eventId(input.runId, vote.voterId, 'vote-confidence'),
      modelId: vote.voterId,
      type: 'benchmark_result',
      capability: 'calibration',
      taskType: input.taskType,
      timestamp: input.timestamp,
      sampleCount: 1,
      weight: 0.15,
      source: 'voting-confidence',
      notes: `Raw vote confidence=${clamp01(vote.confidence).toFixed(4)} recorded for later calibration context; not an outcome score.`,
    });
  }

  return events;
}

function answerQualityEvent(
  input: BuildProfileEventsFromRunInput,
  response: ModelResponse
): ProfileEvent {
  const score = response.error
    ? 0
    : response.withdrawn
      ? 0.55
      : response.content.trim().length > 0
        ? 0.7
        : 0.25;
  return baseCapabilityEvent(input, response.modelId, 'blind_answering', score, 'answer-completion', {
    sampleCount: 1,
    weight: response.error ? 0.8 : 0.25,
    notes: response.error ?? (response.withdrawn ? response.withdrawnReason : undefined),
  });
}

function toolUseEvent(
  input: BuildProfileEventsFromRunInput,
  response: ModelResponse
): ProfileEvent | undefined {
  const calls = response.toolCalls ?? [];
  if (calls.length === 0) return undefined;
  const ok = calls.filter(call => call.ok).length;
  return baseCapabilityEvent(input, response.modelId, 'tool_use', ok / calls.length, 'tool-use', {
    sampleCount: calls.length,
    weight: 0.8,
    notes: `${ok}/${calls.length} tool calls succeeded`,
  });
}

function evidenceAuditEvent(
  input: BuildProfileEventsFromRunInput,
  modelId: string
): ProfileEvent | undefined {
  const assessments = input.userOpinion?.assessments.filter(a => a.modelId === modelId) ?? [];
  if (assessments.length === 0) return undefined;
  const evidenceUsed = assessments.filter(a => a.evidenceUsed).length / assessments.length;
  const decisive = assessments.filter(a => a.stance !== 'insufficient').length / assessments.length;
  return {
    id: eventId(input.runId, modelId, 'evidence-audit'),
    modelId,
    type: 'evidence_audit',
    taskType: input.taskType,
    timestamp: input.timestamp,
    score: clamp01(evidenceUsed * 0.7 + decisive * 0.3),
    sampleCount: assessments.length,
    weight: 1,
    source: 'user-opinion-review',
    notes: `${assessments.length} claim assessments`,
  };
}

function challengeGenerationEvent(
  input: BuildProfileEventsFromRunInput,
  modelId: string
): ProfileEvent | undefined {
  const challenges = input.challenges.filter(c => c.challengerId === modelId);
  if (challenges.length === 0) return undefined;
  const avgConfidence = average(challenges.map(c => c.confidence));
  const severityBonus = average(challenges.map(c => severityValue(c.severity)));
  return {
    id: eventId(input.runId, modelId, 'challenge-generation'),
    modelId,
    type: 'challenge_outcome',
    challengeRole: 'challenger',
    taskType: input.taskType,
    timestamp: input.timestamp,
    score: clamp01(0.45 + avgConfidence * 0.4 + severityBonus * 0.15),
    sampleCount: challenges.length,
    weight: 0.7,
    source: 'auto-challenge',
    notes: `${challenges.length} challenges generated`,
  };
}

function challengeTargetEvent(
  input: BuildProfileEventsFromRunInput,
  modelId: string
): ProfileEvent | undefined {
  const challenges = input.challenges.filter(c => c.targetId === modelId);
  if (challenges.length === 0) return undefined;
  const penalty = average(challenges.map(c => c.confidence * severityValue(c.severity)));
  return {
    id: eventId(input.runId, modelId, 'challenge-target'),
    modelId,
    type: 'challenge_outcome',
    challengeRole: 'target',
    taskType: input.taskType,
    timestamp: input.timestamp,
    score: clamp01(1 - penalty),
    sampleCount: challenges.length,
    weight: 0.6,
    source: 'auto-challenge',
    notes: `${challenges.length} challenges targeted this model`,
  };
}

function baseCapabilityEvent(
  input: BuildProfileEventsFromRunInput,
  modelId: string,
  capability: ModelCapability,
  score: number,
  source: string,
  extra: Partial<ProfileEvent> = {}
): ProfileEvent {
  return {
    id: eventId(input.runId, modelId, capability),
    modelId,
    type: 'benchmark_result',
    capability,
    taskType: input.taskType,
    timestamp: input.timestamp,
    score: clamp01(score),
    sampleCount: 1,
    weight: 1,
    source,
    ...extra,
  };
}

function eventId(runId: string, modelId: string, suffix: string): string {
  return `${runId}:${modelId}:${suffix}`;
}

function severityValue(severity: ProfileSeverity): number {
  switch (severity) {
    case 'high':
      return 1;
    case 'medium':
      return 0.6;
    case 'low':
      return 0.25;
  }
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
