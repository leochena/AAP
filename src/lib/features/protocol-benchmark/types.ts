import { ProtocolOutputContract, UserClaimVerdictStatus } from '@/lib/types';

export interface ProtocolBenchmarkExpected {
  /**
   * Evidence IDs the benchmark considers valid for this case. When present,
   * any output evidence outside this set is counted as hallucinated evidence.
   */
  allowedEvidenceIds?: string[];
  /** Evidence IDs that should appear in the protocol evidence chain. */
  requiredEvidenceIds?: string[];
  /** Evidence IDs that are known traps or fabricated references. */
  hallucinatedEvidenceIds?: string[];
  /** Expected user-claim decisions keyed by claim ID. */
  claimDecisions?: Record<string, UserClaimVerdictStatus>;
  /** User claims that should not be adopted merely because the user asserted them. */
  sycophancyTrapClaimIds?: string[];
  /** Expected resolutions for conflict-bearing claims keyed by claim ID. */
  conflictResolutions?: Record<string, UserClaimVerdictStatus>;
  /** Whether the protocol should abstain or require human review. */
  shouldAbstain?: boolean;
  /** Later-observed correctness probability used for calibration scoring. */
  outcomeProbability?: number;
}

export interface ProtocolBenchmarkCase {
  id: string;
  prompt: string;
  expected: ProtocolBenchmarkExpected;
  metadata?: Record<string, unknown>;
}

export interface ProtocolBenchmarkResult {
  caseId: string;
  strategyId?: string;
  output: ProtocolOutputContract;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export type ProtocolBenchmarkFailureType =
  | 'missing_result'
  | 'unknown_case'
  | 'hallucination'
  | 'missing_evidence'
  | 'sycophancy'
  | 'conflict_resolution'
  | 'abstention';

export interface ProtocolBenchmarkFailure {
  caseId: string;
  type: ProtocolBenchmarkFailureType;
  expected?: string | number | boolean;
  actual?: string | number | boolean;
  message: string;
}

export interface ProtocolBenchmarkMetricCounts {
  hallucinatedResults: number;
  evaluatedResults: number;
  coveredEvidence: number;
  requiredEvidence: number;
  sycophanticClaims: number;
  sycophancyTrapClaims: number;
  correctConflictResolutions: number;
  expectedConflictResolutions: number;
  correctAbstentions: number;
  expectedAbstentions: number;
  calibrationCases: number;
}

export interface ProtocolBenchmarkMetrics {
  caseCount: number;
  resultCount: number;
  completionRate: number;
  hallucinationRate: number;
  sycophancyRate: number;
  evidenceCoverage: number;
  conflictResolutionAccuracy: number;
  abstentionQuality: number;
  calibrationError: number;
  counts: ProtocolBenchmarkMetricCounts;
  failures: ProtocolBenchmarkFailure[];
}

export interface ProtocolStrategyBenchmarkInput {
  strategyId: string;
  results: ProtocolBenchmarkResult[];
}

export type ProtocolMetricWeightKey =
  | 'hallucinationRate'
  | 'sycophancyRate'
  | 'evidenceCoverage'
  | 'conflictResolutionAccuracy'
  | 'abstentionQuality'
  | 'calibrationError';

export type ProtocolMetricWeights = Record<ProtocolMetricWeightKey, number>;

export interface CompareStrategiesOptions {
  weights?: Partial<ProtocolMetricWeights>;
}

export interface ProtocolStrategyReport {
  strategyId: string;
  metrics: ProtocolBenchmarkMetrics;
  score: number;
  rank: number;
}

export interface ProtocolStrategyComparison {
  winner?: string;
  reports: ProtocolStrategyReport[];
  weights: ProtocolMetricWeights;
}
