import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdversarialEngine } from '../AdversarialEngine';
import type { AdversarialConfig, ModelConfig, ModelResponse, RunRequest } from '@/lib/types';

const adversarialConfig: AdversarialConfig = {
  autoChallenge: { enabled: false, threshold: 0.7, maxChallengesPerRound: 3 },
  voting: { enabled: false, mode: 'weighted', threshold: 0.5, tiebreaker: 'first' },
  maxRounds: 1,
  tools: {
    enabled: true,
    searxngUrl: 'http://127.0.0.1:28080',
    searchEngines: 'bing',
    fetchUrl: { enabled: true, maxBytes: 4096, timeoutMs: 10000 },
    codeExec: { enabled: true, image: 'python:3.12-slim', timeoutMs: 10000, memoryMb: 256, cpus: '0.5' },
    concede: { enabled: true },
    maxToolCallsPerGeneration: 6,
    capabilityCacheHours: 24,
  },
};

function model(overrides: Partial<ModelConfig> & { id: string }): ModelConfig {
  return {
    protocol: 'openai',
    baseUrl: 'http://example.com/v1',
    apiKey: 'sk-test',
    model: overrides.id,
    enabled: true,
    weight: 1,
    ...overrides,
  };
}

const request: RunRequest = {
  question: 'q',
  modelIds: ['tool-model', 'text-model', 'claude'],
  source: 'tui-input',
};

describe('AdversarialEngine tool participation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops selected models without verified search capability before debate', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new AdversarialEngine({
      request,
      models: [
        model({ id: 'tool-model', toolCallingSupport: 'yes' }),
        model({ id: 'text-model', toolCallingSupport: 'no' }),
        model({ id: 'claude', protocol: 'anthropic', model: 'claude-opus-4-8' }),
      ],
      adversarialConfig,
      storageDir: '/tmp/aap-test',
    });

    const excluded = await (engine as unknown as { enforceSearchCapableModels: () => Promise<ModelResponse[]> })
      .enforceSearchCapableModels();

    const internals = engine as unknown as {
      options: { models: ModelConfig[] };
      modelMap: Map<string, ModelConfig>;
    };
    expect(internals.options.models.map(m => m.id)).toEqual(['tool-model']);
    expect([...internals.modelMap.keys()]).toEqual(['tool-model']);
    expect(excluded.map(r => r.modelId)).toEqual(['text-model', 'claude']);
    expect(excluded.every(r => r.error?.includes('excluded before debate'))).toBe(true);
  });

  it('fails a multi-model debate if fewer than two selected models can search', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new AdversarialEngine({
      request: { ...request, modelIds: ['tool-model', 'text-model'] },
      models: [
        model({ id: 'tool-model', toolCallingSupport: 'yes' }),
        model({ id: 'text-model', toolCallingSupport: 'no' }),
      ],
      adversarialConfig,
      storageDir: '/tmp/aap-test',
    });

    await expect(engine.run()).rejects.toThrow(/at least 2 are required/);
  });
});
