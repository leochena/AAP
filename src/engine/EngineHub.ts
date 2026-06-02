/**
 * EngineHub - 全局对抗引擎注册中心 + 事件总线
 *
 * 所有触发对抗的入口（TUI、HTTP server）都通过 hub.startRun()，
 * 这样 TUI 可以同时订阅自己触发和外部触发的所有 run。
 */

import { EventEmitter } from 'events';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AdversarialConfig,
  AppConfig,
  EngineEvent,
  ModelConfig,
  RunRequest,
  RunResult,
  RunSnapshot,
} from '@/lib/types';
import { AdversarialEngine } from './AdversarialEngine';
import { addModel, getEnabledModels, loadConfig, saveConfig } from '@/config/loader';

export interface StartRunResult {
  runId: string;
  engine: AdversarialEngine;
  promise: Promise<RunResult>;
}

export class EngineHub extends EventEmitter {
  private config: AppConfig;
  private runs = new Map<string, RunSnapshot>();
  private completedRuns: RunSnapshot[] = [];
  private readonly maxHistory = 50;

  // Per-run subscribers. Lets SSE handlers register without piling up on the
  // global 'engine-event' EventEmitter (which would trip MaxListeners and
  // make every event fan out O(N) past every other client's filter).
  private runListeners = new Map<string, Set<(event: EngineEvent) => void>>();

  constructor(config: AppConfig) {
    super();
    this.config = config;
    // Global 'engine-event' is still used by the TUI's useHub (one subscriber
    // per process). Defensively raise the cap in case multiple panels appear.
    this.setMaxListeners(50);
  }

  setConfig(config: AppConfig) {
    this.config = config;
    this.emit('config-change', config);
  }

  getConfig(): AppConfig {
    return this.config;
  }

  /**
   * Reload config from disk and broadcast `config-change`.
   * Called after external mutations (e.g. CLI in another shell).
   */
  reloadConfig(): AppConfig {
    this.config = loadConfig(this.config.storageDir);
    this.emit('config-change', this.config);
    return this.config;
  }

  /**
   * Append models to config, persist to disk, and broadcast `config-change`.
   * Throws if any new model id collides with an existing one.
   */
  addModelsAndSave(models: ModelConfig[]): AppConfig {
    let next = this.config;
    for (const m of models) {
      next = addModel(next, m);
    }
    saveConfig(next);
    this.config = next;
    this.emit('config-change', next);
    return next;
  }

  /**
   * Allow a local repository root for the read-only audit tools, enable the
   * local-repo plugin, and enable the global tool loop. Used by the TUI so
   * users do not have to leave the app to configure source-code auditing.
   */
  addLocalRepoRootAndSave(path: string): AppConfig {
    const root = resolve(path);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error(`不是有效目录: ${root}`);
    }
    const current = this.config.adversarial.tools.localRepo!;
    const roots = uniqueStrings([...current.roots, root]);
    const next: AppConfig = {
      ...this.config,
      adversarial: {
        ...this.config.adversarial,
        tools: {
          ...this.config.adversarial.tools,
          enabled: true,
          localRepo: {
            ...current,
            enabled: true,
            roots,
          },
        },
      },
    };
    saveConfig(next);
    this.config = next;
    this.emit('config-change', next);
    return next;
  }

  /**
   * Subscribe to events for a single run. Returns an unsubscribe function.
   * Use this from SSE handlers instead of `.on('engine-event', ...)` so a
   * disconnecting client doesn't leak a listener for the rest of the process.
   */
  subscribeRun(runId: string, handler: (event: EngineEvent) => void): () => void {
    let set = this.runListeners.get(runId);
    if (!set) {
      set = new Set();
      this.runListeners.set(runId, set);
    }
    set.add(handler);
    return () => {
      const current = this.runListeners.get(runId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.runListeners.delete(runId);
    };
  }

  /**
   * 解析 modelIds：
   *   - 空数组或包含 "all" → 所有 enabled 模型
   *   - 否则按 id 精确匹配
   */
  resolveModels(modelIds: string[]): ModelConfig[] {
    if (modelIds.length === 0 || modelIds.includes('all')) {
      return getEnabledModels(this.config);
    }
    return modelIds
      .map(id => this.config.models.find(m => m.id === id))
      .filter((m): m is ModelConfig => m !== undefined && m.enabled);
  }

  startRun(request: RunRequest, signal?: AbortSignal): StartRunResult {
    const models = this.resolveModels(request.modelIds);
    if (models.length < 1) {
      throw new Error(
        `No enabled models matching ${JSON.stringify(request.modelIds)}. ` +
          `Available: ${this.config.models.filter(m => m.enabled).map(m => m.id).join(', ')}`
      );
    }

    const engine = new AdversarialEngine({
      request,
      models,
      adversarialConfig: this.config.adversarial,
      storageDir: this.config.storageDir,
      signal,
    });

    // 注册到 runs map
    this.runs.set(engine.runId, engine.snapshot);

    // 把 engine 事件分发：全局广播（兼容 useHub）+ 按 runId 路由
    engine.on('event', (event: EngineEvent) => {
      this.emit('engine-event', event);
      const set = this.runListeners.get(engine.runId);
      if (set && set.size > 0) {
        // copy so handlers may unsubscribe during iteration
        for (const h of [...set]) {
          try { h(event); } catch { /* ignore handler error */ }
        }
      }
    });

    const cleanup = () => {
      this.runs.delete(engine.runId);
      this.runListeners.delete(engine.runId);
      this.completedRuns.unshift(engine.snapshot);
      if (this.completedRuns.length > this.maxHistory) {
        this.completedRuns.pop();
      }
    };

    const promise = engine
      .run()
      .then(result => {
        cleanup();
        return result;
      })
      .catch(err => {
        cleanup();
        throw err;
      });

    return { runId: engine.runId, engine, promise };
  }

  getActiveRuns(): RunSnapshot[] {
    return [...this.runs.values()];
  }

  getCompletedRuns(): RunSnapshot[] {
    return [...this.completedRuns];
  }

  getRun(runId: string): RunSnapshot | undefined {
    return this.runs.get(runId) ?? this.completedRuns.find(r => r.runId === runId);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
