import {
  CalibrationAggregate,
  CalibrationRecord,
  CalibrationTaskSummary,
} from './types';

export const DEFAULT_LOG_LOSS_EPSILON = 1e-15;

export function calculateBrierScore(record: CalibrationRecord): number {
  const outcome = record.outcome ? 1 : 0;
  return roundMetric((clampProbability(record.predictedProbability) - outcome) ** 2);
}

export function calculateLogLoss(
  record: CalibrationRecord,
  epsilon = DEFAULT_LOG_LOSS_EPSILON
): number {
  const probability = clampProbability(record.predictedProbability, epsilon);
  const loss = record.outcome ? -Math.log(probability) : -Math.log(1 - probability);
  return roundMetric(loss);
}

export function aggregateCalibration(records: CalibrationRecord[]): CalibrationAggregate {
  const count = records.length;
  let weightedCount = 0;
  let brierSum = 0;
  let logLossSum = 0;
  let predictedSum = 0;
  let outcomeSum = 0;
  let accuracySum = 0;

  for (const record of records) {
    const weight = recordWeight(record);
    if (weight === 0) continue;

    const probability = clampProbability(record.predictedProbability);
    const outcome = record.outcome ? 1 : 0;
    const predictedCorrect = (probability >= 0.5) === record.outcome;

    weightedCount += weight;
    brierSum += ((probability - outcome) ** 2) * weight;
    logLossSum += calculateLogLoss(record) * weight;
    predictedSum += probability * weight;
    outcomeSum += outcome * weight;
    accuracySum += (predictedCorrect ? 1 : 0) * weight;
  }

  if (weightedCount === 0) {
    return emptyAggregate(count);
  }

  const meanPredictedProbability = predictedSum / weightedCount;
  const outcomeRate = outcomeSum / weightedCount;

  return {
    count,
    weightedCount: roundMetric(weightedCount),
    brierScore: roundMetric(brierSum / weightedCount),
    logLoss: roundMetric(logLossSum / weightedCount),
    meanPredictedProbability: roundMetric(meanPredictedProbability),
    outcomeRate: roundMetric(outcomeRate),
    accuracy: roundMetric(accuracySum / weightedCount),
    calibrationError: roundMetric(Math.abs(meanPredictedProbability - outcomeRate)),
  };
}

export function summarizeCalibrationByTaskType(
  records: CalibrationRecord[]
): CalibrationTaskSummary[] {
  const byTask = groupBy(records, record => record.taskType);

  return [...byTask.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([taskType, taskRecords]) => {
      const byModel = groupBy(taskRecords, record => record.modelId);
      return {
        taskType,
        aggregate: aggregateCalibration(taskRecords),
        byModel: Object.fromEntries(
          [...byModel.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([modelId, modelRecords]) => [modelId, aggregateCalibration(modelRecords)])
        ),
      };
    });
}

function emptyAggregate(count: number): CalibrationAggregate {
  return {
    count,
    weightedCount: 0,
    brierScore: null,
    logLoss: null,
    meanPredictedProbability: null,
    outcomeRate: null,
    accuracy: null,
    calibrationError: null,
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }
  return grouped;
}

function recordWeight(record: CalibrationRecord): number {
  return Math.max(0, record.weight ?? 1);
}

function clampProbability(value: number, epsilon = 0): number {
  if (!Number.isFinite(value)) return epsilon;
  return Math.max(epsilon, Math.min(1 - epsilon, value));
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
