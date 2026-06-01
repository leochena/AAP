export type ModelCapability =
  | 'blind_answering'
  | 'evidence_grounding'
  | 'challenge_generation'
  | 'conflict_adjudication'
  | 'calibration'
  | 'tool_use'
  | 'sycophancy_resistance';

export type ModelRole =
  | 'primary_answerer'
  | 'evidence_checker'
  | 'challenger'
  | 'adjudicator'
  | 'calibration_anchor';

export type ProfileEventType =
  | 'capability_probe'
  | 'benchmark_result'
  | 'calibration_result'
  | 'challenge_outcome'
  | 'sycophancy_signal'
  | 'evidence_audit';

export type ProfileSeverity = 'low' | 'medium' | 'high';

export interface ProfileEvent {
  id?: string;
  modelId?: string;
  type: ProfileEventType;
  timestamp: number;
  taskType?: string;
  capability?: ModelCapability;
  /**
   * Normalized positive score where 1 is best and 0 is worst.
   * Calibration events may instead provide brierScore/logLoss.
   */
  score?: number;
  sampleCount?: number;
  weight?: number;
  brierScore?: number;
  logLoss?: number;
  challengeRole?: 'challenger' | 'target';
  challengeAccepted?: boolean;
  severity?: ProfileSeverity;
  source?: string;
  notes?: string;
}

export interface ModelCapabilityProfile {
  modelId: string;
  events: ProfileEvent[];
  baseWeight?: number;
  createdAt?: number;
  updatedAt?: number;
  labels?: string[];
}

export interface ModelProfileStore {
  schemaVersion: 1;
  profiles: Record<string, ModelCapabilityProfile>;
  updatedAt?: number;
}

export interface CapabilityScore {
  capability: ModelCapability;
  score: number | null;
  eventCount: number;
  sampleCount: number;
}

export interface TaskTypeScore {
  taskType: string;
  score: number;
  eventCount: number;
  sampleCount: number;
}

export interface ModelProfileScore {
  modelId: string;
  overallScore: number;
  voteWeight: number;
  confidence: number;
  eventCount: number;
  sampleCount: number;
  capabilityScores: Record<ModelCapability, CapabilityScore>;
  taskTypeScores: Record<string, TaskTypeScore>;
  sycophancyRisk: 'none' | ProfileSeverity;
  reviewReasons: string[];
}

export interface RoleSuggestion {
  role: ModelRole;
  modelId: string;
  score: number;
  confidence: number;
  reasons: string[];
}
