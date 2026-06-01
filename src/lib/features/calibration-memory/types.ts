export interface CalibrationRecord {
  id: string;
  modelId: string;
  taskType: string;
  predictedProbability: number;
  outcome: boolean;
  timestamp: number;
  runId?: string;
  claimId?: string;
  verdictId?: string;
  weight?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface CalibrationStore {
  schemaVersion: 1;
  records: CalibrationRecord[];
  updatedAt?: number;
}

export interface CalibrationRecordFilter {
  modelId?: string;
  taskType?: string;
  since?: number;
  until?: number;
}

export interface CalibrationAggregate {
  count: number;
  weightedCount: number;
  brierScore: number | null;
  logLoss: number | null;
  meanPredictedProbability: number | null;
  outcomeRate: number | null;
  accuracy: number | null;
  calibrationError: number | null;
}

export interface CalibrationTaskSummary {
  taskType: string;
  aggregate: CalibrationAggregate;
  byModel: Record<string, CalibrationAggregate>;
}
