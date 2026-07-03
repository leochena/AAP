import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdversarialEngine } from '../AdversarialEngine';
import type { AdversarialConfig, EngineEvent, ModelConfig, ModelResponse, RunRequest } from '@/lib/types';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

const adversarialConfig: AdversarialConfig = {
  autoChallenge: { enabled: false, threshold: 0.7, maxChallengesPerRound: 3 },
  voting: { enabled: false, mode: 'weighted', threshold: 0.5, tiebreaker: 'first' },
  maxRounds: 1,
  tools: {
    enabled: false,
    searxngUrl: 'http://127.0.0.1:28080',
    searchEngines: 'bing',
    fetchUrl: { enabled: true, maxBytes: 4096, timeoutMs: 10000 },
    codeExec: { enabled: true, image: 'python:3.12-slim', timeoutMs: 10000, memoryMb: 256, cpus: '0.5' },
    concede: { enabled: true },
    maxToolCallsPerGeneration: 6,
    capabilityCacheHours: 24,
  },
};

const request: RunRequest = {
  question: 'Produce a final answer.',
  modelIds: ['m1'],
  source: 'tui-input',
};

const model: ModelConfig = {
  id: 'm1',
  protocol: 'openai',
  baseUrl: 'http://example.com/v1',
  apiKey: 'sk-test',
  model: 'm1',
  enabled: true,
};

function response(): ModelResponse {
  return {
    modelId: 'm1',
    content: 'Final answer with a claim.',
    tokensIn: 1,
    tokensOut: 2,
    durationMs: 3,
  };
}

describe('AdversarialEngine run report gate', () => {
  it('fails the run instead of reporting completion when the required report cannot be written', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aap-report-gate-'));
    tempDirs.push(tempDir);
    const storageDirFile = join(tempDir, 'storage-file');
    writeFileSync(storageDirFile, 'not a directory', 'utf8');

    const engine = new AdversarialEngine({
      request,
      models: [model],
      adversarialConfig,
      storageDir: storageDirFile,
    });
    (engine as unknown as { runGenerating: () => Promise<ModelResponse[]> }).runGenerating = async () => [
      response(),
    ];

    const events: EngineEvent['type'][] = [];
    engine.on('event', event => events.push(event.type));

    await expect(engine.run()).rejects.toThrow(/Failed to write required run report/);

    expect(engine.snapshot.phase).toBe('failed');
    expect(engine.snapshot.error).toMatch(/Failed to write required run report/);
    expect(events).toContain('run-failed');
    expect(events).not.toContain('run-complete');
  });

  it('fails fast without generation when the run signal is already aborted', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aap-abort-gate-'));
    tempDirs.push(tempDir);
    const abort = new AbortController();
    abort.abort(new Error('client disconnected'));

    const engine = new AdversarialEngine({
      request,
      models: [model],
      adversarialConfig,
      storageDir: tempDir,
      signal: abort.signal,
    });
    const runGenerating = vi.fn(async () => [response()]);
    (engine as unknown as { runGenerating: () => Promise<ModelResponse[]> }).runGenerating = runGenerating;

    const events: EngineEvent['type'][] = [];
    engine.on('event', event => events.push(event.type));

    await expect(engine.run()).rejects.toThrow(/Run aborted: client disconnected/);

    expect(runGenerating).not.toHaveBeenCalled();
    expect(engine.snapshot.phase).toBe('failed');
    expect(events).toContain('run-failed');
    expect(events).not.toContain('run-complete');
  });
});
