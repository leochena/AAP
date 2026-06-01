import {
  CapabilityScore,
  ModelCapability,
  ModelCapabilityProfile,
  ModelProfileScore,
  ModelRole,
  ProfileEvent,
  ProfileSeverity,
  RoleSuggestion,
  TaskTypeScore,
} from './types';

export const MODEL_CAPABILITIES: ModelCapability[] = [
  'blind_answering',
  'evidence_grounding',
  'challenge_generation',
  'conflict_adjudication',
  'calibration',
  'tool_use',
  'sycophancy_resistance',
];

export const MODEL_ROLES: ModelRole[] = [
  'primary_answerer',
  'evidence_checker',
  'challenger',
  'adjudicator',
  'calibration_anchor',
];

export interface ScoreModelProfileOptions {
  taskType?: string;
  minEventsForFullConfidence?: number;
  minSamplesForFullConfidence?: number;
}

export interface SuggestModelRolesOptions extends ScoreModelProfileOptions {
  roles?: ModelRole[];
  maxSuggestionsPerRole?: number;
  minConfidence?: number;
  minRoleScore?: number;
}

interface WeightedAccumulator {
  weightedScore: number;
  weight: number;
  eventCount: number;
  sampleCount: number;
}

const CAPABILITY_WEIGHTS: Record<ModelCapability, number> = {
  blind_answering: 1,
  evidence_grounding: 1.1,
  challenge_generation: 1,
  conflict_adjudication: 1,
  calibration: 1.2,
  tool_use: 0.8,
  sycophancy_resistance: 1.2,
};

const ROLE_CAPABILITY_WEIGHTS: Record<ModelRole, Partial<Record<ModelCapability, number>>> = {
  primary_answerer: {
    blind_answering: 0.4,
    evidence_grounding: 0.2,
    calibration: 0.25,
    sycophancy_resistance: 0.15,
  },
  evidence_checker: {
    evidence_grounding: 0.45,
    tool_use: 0.25,
    calibration: 0.15,
    sycophancy_resistance: 0.15,
  },
  challenger: {
    challenge_generation: 0.45,
    conflict_adjudication: 0.25,
    evidence_grounding: 0.15,
    sycophancy_resistance: 0.15,
  },
  adjudicator: {
    conflict_adjudication: 0.35,
    calibration: 0.3,
    evidence_grounding: 0.2,
    sycophancy_resistance: 0.15,
  },
  calibration_anchor: {
    calibration: 0.55,
    blind_answering: 0.2,
    sycophancy_resistance: 0.25,
  },
};

export function scoreModelProfile(
  profile: ModelCapabilityProfile,
  options: ScoreModelProfileOptions = {}
): ModelProfileScore {
  const events = relevantEvents(profile, options.taskType);
  const capabilityBuckets = createCapabilityBuckets();
  const taskBuckets = new Map<string, WeightedAccumulator>();
  const scoredEvents: Array<{ event: ProfileEvent; score: number; weight: number }> = [];

  for (const event of events) {
    const score = scoreProfileEvent(event);
    if (score === null) continue;

    const weight = eventWeight(event);
    if (weight === 0) continue;

    scoredEvents.push({ event, score, weight });
    const capability = eventCapability(event);
    if (capability) {
      addToBucket(capabilityBuckets[capability], score, weight, event);
    }
    if (event.taskType) {
      const bucket = taskBuckets.get(event.taskType) ?? createBucket();
      addToBucket(bucket, score, weight, event);
      taskBuckets.set(event.taskType, bucket);
    }
  }

  const capabilityScores = finalizeCapabilityScores(capabilityBuckets);
  const overallScore = computeOverallScore(capabilityScores);
  const eventCount = scoredEvents.length;
  const totalSamples = scoredEvents.reduce((sum, item) => sum + sampleCount(item.event), 0);
  const confidence = computeConfidence(
    eventCount,
    totalSamples,
    options.minEventsForFullConfidence ?? 8,
    options.minSamplesForFullConfidence ?? 30
  );
  const sycophancyRisk = inferSycophancyRisk(events, capabilityScores.sycophancy_resistance.score);
  const reviewReasons = buildReviewReasons(eventCount, confidence, overallScore, sycophancyRisk);
  const voteWeight = roundScore((profile.baseWeight ?? 1) * confidence * (0.25 + overallScore * 1.25));

  return {
    modelId: profile.modelId,
    overallScore,
    voteWeight,
    confidence,
    eventCount,
    sampleCount: totalSamples,
    capabilityScores,
    taskTypeScores: finalizeTaskScores(taskBuckets),
    sycophancyRisk,
    reviewReasons,
  };
}

export function suggestModelRoles(
  profiles: ModelCapabilityProfile[],
  options: SuggestModelRolesOptions = {}
): RoleSuggestion[] {
  const roles = options.roles ?? MODEL_ROLES;
  const maxSuggestionsPerRole = options.maxSuggestionsPerRole ?? 1;
  const minConfidence = options.minConfidence ?? 0;
  const minRoleScore = options.minRoleScore ?? 0;
  const scored = profiles.map(profile => scoreModelProfile(profile, options));
  const suggestions: RoleSuggestion[] = [];

  for (const role of roles) {
    const ranked = scored
      .map(score => roleSuggestion(role, score))
      .filter(item => item.confidence >= minConfidence && item.score >= minRoleScore)
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.modelId.localeCompare(b.modelId))
      .slice(0, maxSuggestionsPerRole);
    suggestions.push(...ranked);
  }

  return suggestions;
}

function relevantEvents(
  profile: ModelCapabilityProfile,
  taskType: string | undefined
): ProfileEvent[] {
  return profile.events.filter(event => {
    if (event.modelId && event.modelId !== profile.modelId) return false;
    if (!taskType) return true;
    return event.taskType === undefined || event.taskType === taskType;
  });
}

function scoreProfileEvent(event: ProfileEvent): number | null {
  switch (event.type) {
    case 'calibration_result':
      return calibrationEventScore(event);
    case 'challenge_outcome':
      return challengeEventScore(event);
    case 'sycophancy_signal':
      return sycophancyEventScore(event);
    case 'capability_probe':
    case 'benchmark_result':
    case 'evidence_audit':
      return event.score === undefined ? null : clamp01(event.score);
  }
}

function eventCapability(event: ProfileEvent): ModelCapability | null {
  if (event.capability) return event.capability;

  switch (event.type) {
    case 'calibration_result':
      return 'calibration';
    case 'challenge_outcome':
      return event.challengeRole === 'target' ? 'conflict_adjudication' : 'challenge_generation';
    case 'sycophancy_signal':
      return 'sycophancy_resistance';
    case 'evidence_audit':
      return 'evidence_grounding';
    case 'capability_probe':
    case 'benchmark_result':
      return null;
  }
}

function calibrationEventScore(event: ProfileEvent): number | null {
  const scores: number[] = [];
  if (event.score !== undefined) scores.push(clamp01(event.score));
  if (event.brierScore !== undefined) scores.push(clamp01(1 - event.brierScore));
  if (event.logLoss !== undefined) scores.push(clamp01(Math.exp(-Math.max(0, event.logLoss))));
  if (scores.length === 0) return null;
  return average(scores);
}

function challengeEventScore(event: ProfileEvent): number | null {
  if (event.score !== undefined) return clamp01(event.score);
  if (event.challengeAccepted === undefined) return null;

  if (event.challengeRole === 'target') {
    return event.challengeAccepted ? 0.2 : 0.8;
  }
  return event.challengeAccepted ? 1 : 0.4;
}

function sycophancyEventScore(event: ProfileEvent): number | null {
  if (event.score !== undefined) return clamp01(event.score);
  if (!event.severity) return null;
  return 1 - severityPenalty(event.severity);
}

function eventWeight(event: ProfileEvent): number {
  return Math.max(0, event.weight ?? 1) * sampleCount(event);
}

function sampleCount(event: ProfileEvent): number {
  return Math.max(1, event.sampleCount ?? 1);
}

function computeOverallScore(
  capabilityScores: Record<ModelCapability, CapabilityScore>
): number {
  let weightedScore = 0;
  let weight = 0;

  for (const capability of MODEL_CAPABILITIES) {
    const score = capabilityScores[capability].score;
    if (score === null) continue;
    const capabilityWeight = CAPABILITY_WEIGHTS[capability];
    weightedScore += score * capabilityWeight;
    weight += capabilityWeight;
  }

  if (weight === 0) return 0;
  return roundScore(weightedScore / weight);
}

function computeConfidence(
  eventCount: number,
  sampleCount: number,
  minEventsForFullConfidence: number,
  minSamplesForFullConfidence: number
): number {
  if (eventCount === 0) return 0;
  const eventConfidence = clamp01(eventCount / Math.max(1, minEventsForFullConfidence));
  const sampleConfidence = clamp01(sampleCount / Math.max(1, minSamplesForFullConfidence));
  return roundScore(eventConfidence * 0.45 + sampleConfidence * 0.55);
}

function inferSycophancyRisk(
  events: ProfileEvent[],
  resistanceScore: number | null
): 'none' | ProfileSeverity {
  const worstSignal = events
    .filter(event => event.type === 'sycophancy_signal' && event.severity)
    .map(event => event.severity as ProfileSeverity)
    .sort((a, b) => severityPenalty(b) - severityPenalty(a))[0];

  if (worstSignal) return worstSignal;
  if (resistanceScore !== null && resistanceScore < 0.4) return 'high';
  if (resistanceScore !== null && resistanceScore < 0.65) return 'medium';
  return 'none';
}

function buildReviewReasons(
  eventCount: number,
  confidence: number,
  overallScore: number,
  sycophancyRisk: 'none' | ProfileSeverity
): string[] {
  const reasons: string[] = [];
  if (eventCount === 0) reasons.push('no profile events recorded');
  else if (confidence < 0.35) reasons.push('limited profile evidence');
  if (overallScore > 0 && overallScore < 0.5) reasons.push('low measured profile score');
  if (sycophancyRisk === 'high') reasons.push('high sycophancy risk');
  else if (sycophancyRisk === 'medium') reasons.push('medium sycophancy risk');
  return reasons;
}

function roleSuggestion(role: ModelRole, score: ModelProfileScore): RoleSuggestion {
  const weights = ROLE_CAPABILITY_WEIGHTS[role];
  let weightedScore = 0;
  let knownWeight = 0;
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + (value ?? 0), 0);
  const known: Array<{ capability: ModelCapability; score: number }> = [];

  for (const [capability, weight] of Object.entries(weights) as Array<[ModelCapability, number]>) {
    const capabilityScore = score.capabilityScores[capability].score;
    if (capabilityScore === null) continue;
    weightedScore += capabilityScore * weight;
    knownWeight += weight;
    known.push({ capability, score: capabilityScore });
  }

  const roleEvidenceCoverage = totalWeight === 0 ? 0 : knownWeight / totalWeight;
  const rawRoleScore =
    knownWeight === 0 ? score.overallScore * 0.4 : weightedScore / knownWeight;
  const adjustedScore = roundScore(rawRoleScore * (0.5 + roleEvidenceCoverage * 0.5));
  const confidence = roundScore(score.confidence * roleEvidenceCoverage);

  return {
    role,
    modelId: score.modelId,
    score: adjustedScore,
    confidence,
    reasons: roleReasons(role, known, roleEvidenceCoverage, score),
  };
}

function roleReasons(
  role: ModelRole,
  known: Array<{ capability: ModelCapability; score: number }>,
  roleEvidenceCoverage: number,
  score: ModelProfileScore
): string[] {
  const reasons: string[] = [];
  const strongest = [...known].sort((a, b) => b.score - a.score)[0];
  if (strongest) {
    reasons.push(`${role} supported by ${strongest.capability}=${roundScore(strongest.score)}`);
  } else {
    reasons.push(`${role} has no direct capability evidence`);
  }
  if (roleEvidenceCoverage < 0.5) reasons.push('role evidence is sparse');
  if (score.sycophancyRisk !== 'none') reasons.push(`${score.sycophancyRisk} sycophancy risk`);
  return reasons;
}

function finalizeCapabilityScores(
  buckets: Record<ModelCapability, WeightedAccumulator>
): Record<ModelCapability, CapabilityScore> {
  return Object.fromEntries(
    MODEL_CAPABILITIES.map(capability => {
      const bucket = buckets[capability];
      const score = bucket.weight === 0 ? null : roundScore(bucket.weightedScore / bucket.weight);
      return [
        capability,
        {
          capability,
          score,
          eventCount: bucket.eventCount,
          sampleCount: bucket.sampleCount,
        },
      ];
    })
  ) as Record<ModelCapability, CapabilityScore>;
}

function finalizeTaskScores(taskBuckets: Map<string, WeightedAccumulator>): Record<string, TaskTypeScore> {
  return Object.fromEntries(
    [...taskBuckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([taskType, bucket]) => [
        taskType,
        {
          taskType,
          score: roundScore(bucket.weightedScore / bucket.weight),
          eventCount: bucket.eventCount,
          sampleCount: bucket.sampleCount,
        },
      ])
  );
}

function createCapabilityBuckets(): Record<ModelCapability, WeightedAccumulator> {
  return Object.fromEntries(
    MODEL_CAPABILITIES.map(capability => [capability, createBucket()])
  ) as Record<ModelCapability, WeightedAccumulator>;
}

function createBucket(): WeightedAccumulator {
  return {
    weightedScore: 0,
    weight: 0,
    eventCount: 0,
    sampleCount: 0,
  };
}

function addToBucket(
  bucket: WeightedAccumulator,
  score: number,
  weight: number,
  event: ProfileEvent
): void {
  bucket.weightedScore += score * weight;
  bucket.weight += weight;
  bucket.eventCount += 1;
  bucket.sampleCount += sampleCount(event);
}

function severityPenalty(severity: ProfileSeverity): number {
  switch (severity) {
    case 'low':
      return 0.2;
    case 'medium':
      return 0.5;
    case 'high':
      return 0.8;
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}
