import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addCalibrationRecord,
  aggregateCalibration,
  appendCalibrationRecord,
  calculateBrierScore,
  calculateLogLoss,
  createCalibrationStore,
  filterCalibrationRecords,
  loadCalibrationStore,
  saveCalibrationStore,
  summarizeCalibrationByTaskType,
} from '..';
import { CalibrationRecord } from '../types';

let tempDirs: string[] = [];

function record(overrides: Partial<CalibrationRecord>): CalibrationRecord {
  return {
    id: 'r1',
    modelId: 'm1',
    taskType: 'fact-check',
    predictedProbability: 0.8,
    outcome: true,
    timestamp: 1,
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('calibration memory scoring', () => {
  it('calculates Brier score and log loss for binary outcomes', () => {
    const positive = record({ predictedProbability: 0.8, outcome: true });
    const negative = record({ predictedProbability: 0.2, outcome: false });

    expect(calculateBrierScore(positive)).toBe(0.04);
    expect(calculateBrierScore(negative)).toBe(0.04);
    expect(calculateLogLoss(positive)).toBeCloseTo(-Math.log(0.8), 6);
  });

  it('aggregates weighted Brier and log loss', () => {
    const records = [
      record({ id: 'good', predictedProbability: 0.9, outcome: true, weight: 2 }),
      record({ id: 'bad', predictedProbability: 0.9, outcome: false, weight: 1 }),
    ];

    const aggregate = aggregateCalibration(records);

    expect(aggregate.count).toBe(2);
    expect(aggregate.weightedCount).toBe(3);
    expect(aggregate.brierScore).toBeCloseTo(((0.1 ** 2) * 2 + (0.9 ** 2)) / 3, 6);
    expect(aggregate.accuracy).toBeCloseTo(2 / 3, 6);
    expect(aggregate.logLoss).toBeCloseTo((-Math.log(0.9) * 2 + -Math.log(0.1)) / 3, 6);
  });

  it('summarizes records by task type with model breakdowns', () => {
    const records = [
      record({ id: 'a', modelId: 'm1', taskType: 'fact-check', predictedProbability: 0.8, outcome: true }),
      record({ id: 'b', modelId: 'm2', taskType: 'fact-check', predictedProbability: 0.7, outcome: false }),
      record({ id: 'c', modelId: 'm1', taskType: 'code-review', predictedProbability: 0.6, outcome: true }),
    ];

    const summaries = summarizeCalibrationByTaskType(records);

    expect(summaries.map(summary => summary.taskType)).toEqual(['code-review', 'fact-check']);
    expect(summaries[1].aggregate.count).toBe(2);
    expect(Object.keys(summaries[1].byModel)).toEqual(['m1', 'm2']);
    expect(summaries[1].byModel.m1.count).toBe(1);
  });
});

describe('calibration store helpers', () => {
  it('adds and filters records without mutating the original store', () => {
    const store = createCalibrationStore([record({ id: 'a', modelId: 'm1', timestamp: 10 })]);
    const updated = addCalibrationRecord(
      store,
      record({ id: 'b', modelId: 'm2', taskType: 'forecast', timestamp: 20 })
    );

    expect(store.records.map(item => item.id)).toEqual(['a']);
    expect(updated.records.map(item => item.id)).toEqual(['a', 'b']);
    expect(filterCalibrationRecords(updated, { modelId: 'm2' }).map(item => item.id)).toEqual(['b']);
    expect(filterCalibrationRecords(updated, { since: 11 }).map(item => item.id)).toEqual(['b']);
  });

  it('saves, loads, and appends JSON stores atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aap-calibration-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'calibration.json');

    saveCalibrationStore(filePath, createCalibrationStore([record({ id: 'a', timestamp: 1 })]));
    const loaded = loadCalibrationStore(filePath);
    const appended = appendCalibrationRecord(filePath, record({ id: 'b', timestamp: 2 }));

    expect(loaded.records.map(item => item.id)).toEqual(['a']);
    expect(appended.records.map(item => item.id)).toEqual(['a', 'b']);
    expect(loadCalibrationStore(filePath).records.map(item => item.id)).toEqual(['a', 'b']);
  });
});
