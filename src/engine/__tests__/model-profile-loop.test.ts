import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AdversarialEngine } from '../AdversarialEngine';
import { appendProfileEvents, MODEL_PROFILE_STORE_FILENAME } from '@/lib/features/model-profile';
import type { AdversarialConfig, ModelConfig, RunRequest } from '@/lib/types';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

const adversarialConfig: AdversarialConfig = {
  autoChallenge: { enabled: false, threshold: 0.7, maxChallengesPerRound: 3 },
  voting: { enabled: true, mode: 'weighted', threshold: 0.5, tiebreaker: 'first' },
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

function model(id: string): ModelConfig {
  return {
    id,
    protocol: 'openai',
    baseUrl: 'http://example.com/v1',
    apiKey: 'sk',
    model: id,
    weight: 1,
    enabled: true,
  };
}

describe('AdversarialEngine model-profile loop', () => {
  it('uses stored model profile scores to adjust vote weights before the next run', () => {
    const storageDir = mkdtempSync(join(tmpdir(), 'aap-engine-profile-'));
    tempDirs.push(storageDir);
    appendProfileEvents(join(storageDir, MODEL_PROFILE_STORE_FILENAME), [
      { modelId: 'strong', type: 'benchmark_result', capability: 'evidence_grounding', score: 0.95, sampleCount: 30, timestamp: 1 },
      { modelId: 'strong', type: 'benchmark_result', capability: 'calibration', score: 0.92, sampleCount: 30, timestamp: 2 },
      { modelId: 'strong', type: 'benchmark_result', capability: 'sycophancy_resistance', score: 0.9, sampleCount: 30, timestamp: 3 },
      { modelId: 'risky', type: 'sycophancy_signal', severity: 'high', sampleCount: 3, timestamp: 4 },
    ]);
    const request: RunRequest = {
      question: 'Decide with evidence',
      modelIds: ['strong', 'risky'],
      source: 'tui-input',
    };
    const engine = new AdversarialEngine({
      request,
      models: [model('strong'), model('risky')],
      adversarialConfig,
      storageDir,
    });

    const weights = (engine as unknown as { buildVoteWeights: () => Record<string, number> | undefined })
      .buildVoteWeights();

    expect(weights?.strong).toBeGreaterThan(1);
    expect(weights?.risky).toBeLessThan(1);
  });
});
