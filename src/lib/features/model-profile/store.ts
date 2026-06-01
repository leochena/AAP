import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { ModelCapabilityProfile, ModelProfileStore, ProfileEvent } from './types';

export const MODEL_PROFILE_STORE_FILENAME = 'model-profiles.json';
const SCHEMA_VERSION = 1;
const DEFAULT_MAX_EVENTS_PER_MODEL = 500;

export function createModelProfileStore(
  profiles: Record<string, ModelCapabilityProfile> = {}
): ModelProfileStore {
  const normalized = Object.fromEntries(
    Object.entries(profiles).map(([modelId, profile]) => [modelId, normalizeProfile(modelId, profile)])
  );
  const timestamps = Object.values(normalized)
    .flatMap(profile => profile.events.map(event => event.timestamp))
    .filter(Number.isFinite);
  return {
    schemaVersion: SCHEMA_VERSION,
    profiles: normalized,
    updatedAt: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
  };
}

export function addProfileEvent(
  store: ModelProfileStore,
  modelId: string,
  event: ProfileEvent,
  options: { baseWeight?: number; maxEventsPerModel?: number } = {}
): ModelProfileStore {
  const maxEvents = options.maxEventsPerModel ?? DEFAULT_MAX_EVENTS_PER_MODEL;
  const current = store.profiles[modelId] ?? {
    modelId,
    events: [],
    createdAt: event.timestamp,
  };
  const nextEvent = { ...event, modelId };
  const events = [...current.events, nextEvent]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-maxEvents);
  const nextProfile: ModelCapabilityProfile = {
    ...current,
    modelId,
    baseWeight: options.baseWeight ?? current.baseWeight,
    events,
    createdAt: current.createdAt ?? event.timestamp,
    updatedAt: event.timestamp,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    profiles: {
      ...store.profiles,
      [modelId]: nextProfile,
    },
    updatedAt: Math.max(store.updatedAt ?? 0, event.timestamp),
  };
}

export function addProfileEvents(
  store: ModelProfileStore,
  events: ProfileEvent[],
  options: {
    baseWeights?: Record<string, number>;
    maxEventsPerModel?: number;
  } = {}
): ModelProfileStore {
  return events.reduce((next, event) => {
    if (!event.modelId) return next;
    return addProfileEvent(next, event.modelId, event, {
      baseWeight: options.baseWeights?.[event.modelId],
      maxEventsPerModel: options.maxEventsPerModel,
    });
  }, store);
}

export function loadModelProfileStore(filePath: string): ModelProfileStore {
  if (!existsSync(filePath)) return createModelProfileStore();
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    return parseStore(parsed);
  } catch {
    return createModelProfileStore();
  }
}

export function saveModelProfileStore(filePath: string, store: ModelProfileStore): void {
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

export function appendProfileEvents(
  filePath: string,
  events: ProfileEvent[],
  options: {
    baseWeights?: Record<string, number>;
    maxEventsPerModel?: number;
  } = {}
): ModelProfileStore {
  const store = addProfileEvents(loadModelProfileStore(filePath), events, options);
  saveModelProfileStore(filePath, store);
  return store;
}

function parseStore(value: unknown): ModelProfileStore {
  if (!isRecordObject(value)) return createModelProfileStore();
  const rawProfiles = isRecordObject(value.profiles) ? value.profiles : {};
  const profiles: Record<string, ModelCapabilityProfile> = {};
  for (const [modelId, rawProfile] of Object.entries(rawProfiles)) {
    if (!isRecordObject(rawProfile)) continue;
    profiles[modelId] = normalizeProfile(modelId, rawProfile);
  }
  const store = createModelProfileStore(profiles);
  if (typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)) {
    store.updatedAt = value.updatedAt;
  }
  return store;
}

function normalizeProfile(
  modelId: string,
  value: Partial<ModelCapabilityProfile> | Record<string, unknown>
): ModelCapabilityProfile {
  const events = Array.isArray(value.events)
    ? value.events.filter(isProfileEvent)
    : [];
  return {
    modelId,
    events,
    baseWeight: typeof value.baseWeight === 'number' ? value.baseWeight : undefined,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : undefined,
    labels: Array.isArray(value.labels) ? value.labels.filter((item): item is string => typeof item === 'string') : undefined,
  };
}

function isProfileEvent(value: unknown): value is ProfileEvent {
  if (!isRecordObject(value)) return false;
  return typeof value.type === 'string' &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp);
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
