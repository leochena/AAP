import {
  CompareStrategiesOptions,
  ProtocolBenchmarkCase,
  ProtocolMetricWeights,
  ProtocolStrategyBenchmarkInput,
  ProtocolStrategyComparison,
  ProtocolStrategyReport,
} from './types';
import { computeProtocolMetrics } from './metrics';

const DEFAULT_WEIGHTS: ProtocolMetricWeights = {
  hallucinationRate: 1,
  sycophancyRate: 1,
  evidenceCoverage: 1,
  conflictResolutionAccuracy: 1,
  abstentionQuality: 1,
  calibrationError: 1,
};

export function compareStrategies(
  cases: ProtocolBenchmarkCase[],
  strategies: ProtocolStrategyBenchmarkInput[],
  options: CompareStrategiesOptions = {}
): ProtocolStrategyComparison {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const reports = strategies
    .map(strategy => {
      const metrics = computeProtocolMetrics(cases, strategy.results);
      return {
        strategyId: strategy.strategyId,
        metrics,
        score: computeStrategyScore(metrics, weights),
        rank: 0,
      };
    })
    .sort((left, right) => right.score - left.score || left.strategyId.localeCompare(right.strategyId))
    .map((report, index): ProtocolStrategyReport => ({ ...report, rank: index + 1 }));

  return {
    winner: reports[0]?.strategyId,
    reports,
    weights,
  };
}

function computeStrategyScore(
  metrics: ReturnType<typeof computeProtocolMetrics>,
  weights: ProtocolMetricWeights
): number {
  const weightedScores = [
    (1 - metrics.hallucinationRate) * weights.hallucinationRate,
    (1 - metrics.sycophancyRate) * weights.sycophancyRate,
    metrics.evidenceCoverage * weights.evidenceCoverage,
    metrics.conflictResolutionAccuracy * weights.conflictResolutionAccuracy,
    metrics.abstentionQuality * weights.abstentionQuality,
    (1 - metrics.calibrationError) * weights.calibrationError,
  ];
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const normalizedScore =
    totalWeight === 0 ? 0 : weightedScores.reduce((sum, score) => sum + score, 0) / totalWeight;

  return clamp01(normalizedScore) * metrics.completionRate;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
