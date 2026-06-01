export type ForecastSignalKind =
  | 'base-rate'
  | 'poll'
  | 'market'
  | 'fundamental'
  | 'expert'
  | 'qualitative'
  | 'risk';

export interface ForecastSignal {
  name: string;
  kind: ForecastSignalKind;
  candidateId?: string;
  weight: number;
  impact: number;
  reliability?: number;
  description?: string;
}

export interface ForecastCandidate {
  id: string;
  name: string;
  baseRate?: number;
  signals?: ForecastSignal[];
  uncertainty?: number;
}

export interface ForecastQuestion {
  id: string;
  title: string;
  candidates: ForecastCandidate[];
  signals?: ForecastSignal[];
  qualitativeSignalCap?: number;
}

export interface ForecastCandidateResult {
  candidateId: string;
  name: string;
  probability: number;
  confidenceInterval: [number, number];
  topDrivers: string[];
  rawScore: number;
  uncertainty: number;
}

export interface ForecastResult {
  questionId: string;
  title: string;
  candidates: ForecastCandidateResult[];
  probabilitySum: number;
  notes: string[];
}

export function runForecastModel(question: ForecastQuestion): ForecastResult {
  const n = Math.max(1, question.candidates.length);
  const qualitativeCap = question.qualitativeSignalCap ?? 0.2;
  const raw = question.candidates.map(candidate => {
    const base = clampProbability(candidate.baseRate ?? 1 / n);
    const allSignals = [
      ...(question.signals ?? []).filter(s => !s.candidateId || s.candidateId === candidate.id),
      ...(candidate.signals ?? []),
    ];
    const qualitativeTotal = clamp(
      allSignals
        .filter(s => s.kind === 'qualitative')
        .reduce((sum, signal) => sum + signalEffect(signal), 0),
      -qualitativeCap,
      qualitativeCap
    );
    const structuredTotal = allSignals
      .filter(s => s.kind !== 'qualitative')
      .reduce((sum, signal) => sum + signalEffect(signal), 0);
    const score = Math.exp(logit(base) + structuredTotal + qualitativeTotal);
    const uncertainty = clamp(
      candidate.uncertainty ?? 0.18 + allSignals.filter(s => s.reliability !== undefined && s.reliability < 0.5).length * 0.03,
      0.05,
      0.5
    );
    return { candidate, allSignals, score, uncertainty };
  });

  const total = raw.reduce((sum, row) => sum + row.score, 0) || 1;
  const candidates = raw
    .map(row => {
      const probability = row.score / total;
      const halfWidth = row.uncertainty * Math.sqrt(probability * (1 - probability));
      return {
        candidateId: row.candidate.id,
        name: row.candidate.name,
        probability,
        confidenceInterval: [
          clampProbability(probability - halfWidth),
          clampProbability(probability + halfWidth),
        ] as [number, number],
        topDrivers: topDrivers(row.allSignals),
        rawScore: row.score,
        uncertainty: row.uncertainty,
      };
    })
    .sort((a, b) => b.probability - a.probability);

  return {
    questionId: question.id,
    title: question.title,
    candidates,
    probabilitySum: candidates.reduce((sum, c) => sum + c.probability, 0),
    notes: [
      'Probabilities are normalized from structured base rates and weighted signals.',
      `Qualitative LLM-style signals are capped at ±${qualitativeCap.toFixed(2)} logit impact.`,
    ],
  };
}

export function brierScore(probability: number, actual: boolean): number {
  const p = clampProbability(probability);
  return (p - (actual ? 1 : 0)) ** 2;
}

export function logLoss(probability: number, actual: boolean): number {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return -(actual ? Math.log(p) : Math.log(1 - p));
}

export function normalizeProbabilities<T extends { probability: number }>(items: T[]): T[] {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.probability), 0);
  if (total === 0) {
    const equal = items.length === 0 ? 0 : 1 / items.length;
    return items.map(item => ({ ...item, probability: equal }));
  }
  return items.map(item => ({ ...item, probability: Math.max(0, item.probability) / total }));
}

export function clampProbability(value: number): number {
  return clamp(value, 0.0001, 0.9999);
}

function signalEffect(signal: ForecastSignal): number {
  const reliability = clamp(signal.reliability ?? 0.7, 0, 1);
  return signal.weight * signal.impact * reliability;
}

function topDrivers(signals: ForecastSignal[]): string[] {
  return signals
    .slice()
    .sort((a, b) => Math.abs(signalEffect(b)) - Math.abs(signalEffect(a)))
    .slice(0, 3)
    .map(signal => `${signal.name}: ${signal.description ?? signal.kind}`);
}

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
