/**
 * 应用配置加载与持久化
 * Config loader - reads/writes ~/.aap/config.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { AppConfig, ModelConfig } from '@/lib/types';

export const DEFAULT_STORAGE_DIR = join(homedir(), '.aap');
export const CONFIG_FILENAME = 'config.json';

export const DEFAULT_CONFIG: AppConfig = {
  models: [],
  server: {
    port: 28788,
    host: '127.0.0.1',
  },
  adversarial: {
    autoChallenge: {
      enabled: true,
      threshold: 0.7,
      maxChallengesPerRound: 3,
    },
    voting: {
      enabled: true,
      mode: 'weighted',
      threshold: 0.5,
      tiebreaker: 'first',
    },
    maxRounds: 4,
    roundControl: {
      minRounds: 2,
      continueOnHighSeverityChallenge: true,
      continueOnMediumSeverityChallenge: true,
      continueOnRequiredRevision: true,
    },
    tools: {
      enabled: false,                              // 默认关闭：求真模式需用户显式打开
      searxngUrl: 'http://127.0.0.1:28080',
      searchEngines: 'bing',
      fetchUrl: { enabled: true, maxBytes: 4096, timeoutMs: 10000 },
      codeExec: {
        enabled: true,
        image: 'python:3.12-slim',
        timeoutMs: 10000,
        memoryMb: 256,
        cpus: '0.5',
        wslDistro: process.platform === 'win32' ? 'Ubuntu' : undefined,
      },
      localRepo: {
        enabled: false,
        roots: [],
        maxFiles: 200,
        maxFileBytes: 256 * 1024,
        maxReadBytes: 16 * 1024,
        maxSearchResults: 40,
        allowCommands: false,
        allowedCommands: ['npm test', 'npm run type-check', 'npm run build'],
        commandTimeoutMs: 30000,
      },
      concede: { enabled: true },
      maxToolCallsPerGeneration: 6,
      capabilityCacheHours: 24,
    },
  },
  storageDir: DEFAULT_STORAGE_DIR,
};

export function getConfigPath(storageDir = DEFAULT_STORAGE_DIR): string {
  return join(storageDir, CONFIG_FILENAME);
}

export function ensureStorageDir(storageDir = DEFAULT_STORAGE_DIR): void {
  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true });
  }
}

export function loadConfig(storageDir = DEFAULT_STORAGE_DIR): AppConfig {
  const path = getConfigPath(storageDir);
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG, storageDir };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return mergeWithDefaults(parsed, storageDir);
  } catch (err) {
    throw new Error(
      `Failed to load config from ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function saveConfig(config: AppConfig): void {
  ensureStorageDir(config.storageDir);
  const path = getConfigPath(config.storageDir);
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
}

function mergeWithDefaults(
  partial: Partial<AppConfig>,
  storageDir: string
): AppConfig {
  const defaultRoundControl = DEFAULT_CONFIG.adversarial.roundControl!;
  return {
    models: partial.models ?? [],
    server: {
      ...DEFAULT_CONFIG.server,
      ...(partial.server ?? {}),
    },
    adversarial: {
      autoChallenge: {
        ...DEFAULT_CONFIG.adversarial.autoChallenge,
        ...(partial.adversarial?.autoChallenge ?? {}),
      },
      voting: {
        ...DEFAULT_CONFIG.adversarial.voting,
        ...(partial.adversarial?.voting ?? {}),
      },
      maxRounds:
        partial.adversarial?.maxRounds ?? DEFAULT_CONFIG.adversarial.maxRounds,
      roundControl: {
        minRounds: defaultRoundControl.minRounds,
        continueOnHighSeverityChallenge: defaultRoundControl.continueOnHighSeverityChallenge,
        continueOnMediumSeverityChallenge: defaultRoundControl.continueOnMediumSeverityChallenge,
        continueOnRequiredRevision: defaultRoundControl.continueOnRequiredRevision,
        ...(partial.adversarial?.roundControl ?? {}),
      },
      tools: {
        ...DEFAULT_CONFIG.adversarial.tools,
        ...(partial.adversarial?.tools ?? {}),
        fetchUrl: {
          ...DEFAULT_CONFIG.adversarial.tools.fetchUrl,
          ...(partial.adversarial?.tools?.fetchUrl ?? {}),
        },
        codeExec: {
          ...DEFAULT_CONFIG.adversarial.tools.codeExec,
          ...(partial.adversarial?.tools?.codeExec ?? {}),
        },
        localRepo: {
          ...DEFAULT_CONFIG.adversarial.tools.localRepo!,
          ...(partial.adversarial?.tools?.localRepo ?? {}),
        },
        concede: {
          ...DEFAULT_CONFIG.adversarial.tools.concede,
          ...(partial.adversarial?.tools?.concede ?? {}),
        },
      },
    },
    storageDir: partial.storageDir ?? storageDir,
  };
}

// ========== Model CRUD ==========

export function addModel(config: AppConfig, model: ModelConfig): AppConfig {
  if (config.models.some(m => m.id === model.id)) {
    throw new Error(`Model with id "${model.id}" already exists`);
  }
  return { ...config, models: [...config.models, model] };
}

export function removeModel(config: AppConfig, id: string): AppConfig {
  return { ...config, models: config.models.filter(m => m.id !== id) };
}

export function updateModel(
  config: AppConfig,
  id: string,
  patch: Partial<Omit<ModelConfig, 'id'>>
): AppConfig {
  const idx = config.models.findIndex(m => m.id === id);
  if (idx === -1) {
    throw new Error(`Model with id "${id}" not found`);
  }
  const updated = [...config.models];
  updated[idx] = { ...updated[idx], ...patch };
  return { ...config, models: updated };
}

export function getModel(config: AppConfig, id: string): ModelConfig | undefined {
  return config.models.find(m => m.id === id);
}

export function getEnabledModels(config: AppConfig): ModelConfig[] {
  return config.models.filter(m => m.enabled);
}
