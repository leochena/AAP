import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { CalibrationRecord, CalibrationRecordFilter, CalibrationStore } from './types';

const SCHEMA_VERSION = 1;
export const CALIBRATION_MEMORY_STORE_FILENAME = 'calibration-memory.json';

export function createCalibrationStore(records: CalibrationRecord[] = []): CalibrationStore {
  const store: CalibrationStore = {
    schemaVersion: SCHEMA_VERSION,
    records: [...records],
  };
  const updatedAt = latestTimestamp(records);
  if (updatedAt !== undefined) store.updatedAt = updatedAt;
  return store;
}

export function addCalibrationRecord(
  store: CalibrationStore,
  record: CalibrationRecord
): CalibrationStore {
  const records = [...store.records, record];
  return {
    schemaVersion: SCHEMA_VERSION,
    records,
    updatedAt: Math.max(store.updatedAt ?? 0, record.timestamp),
  };
}

export function filterCalibrationRecords(
  store: CalibrationStore,
  filter: CalibrationRecordFilter = {}
): CalibrationRecord[] {
  return store.records.filter(record => {
    if (filter.modelId && record.modelId !== filter.modelId) return false;
    if (filter.taskType && record.taskType !== filter.taskType) return false;
    if (filter.since !== undefined && record.timestamp < filter.since) return false;
    if (filter.until !== undefined && record.timestamp > filter.until) return false;
    return true;
  });
}

export function loadCalibrationStore(filePath: string): CalibrationStore {
  if (!existsSync(filePath)) return createCalibrationStore();

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    return parseStore(parsed);
  } catch {
    return createCalibrationStore();
  }
}

export function saveCalibrationStore(filePath: string, store: CalibrationStore): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(parseStore(store), null, 2), 'utf-8');
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }
}

export function appendCalibrationRecord(
  filePath: string,
  record: CalibrationRecord
): CalibrationStore {
  const store = addCalibrationRecord(loadCalibrationStore(filePath), record);
  saveCalibrationStore(filePath, store);
  return store;
}

function parseStore(value: unknown): CalibrationStore {
  if (Array.isArray(value)) {
    return createCalibrationStore(value.filter(isCalibrationRecord));
  }

  if (!isRecordObject(value)) return createCalibrationStore();
  const records = Array.isArray(value.records)
    ? value.records.filter(isCalibrationRecord)
    : [];
  const store = createCalibrationStore(records);
  if (typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)) {
    store.updatedAt = value.updatedAt;
  }
  return store;
}

function isCalibrationRecord(value: unknown): value is CalibrationRecord {
  if (!isRecordObject(value)) return false;
  return typeof value.id === 'string' &&
    typeof value.modelId === 'string' &&
    typeof value.taskType === 'string' &&
    typeof value.predictedProbability === 'number' &&
    typeof value.outcome === 'boolean' &&
    typeof value.timestamp === 'number';
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function latestTimestamp(records: CalibrationRecord[]): number | undefined {
  if (records.length === 0) return undefined;
  return Math.max(...records.map(record => record.timestamp));
}
