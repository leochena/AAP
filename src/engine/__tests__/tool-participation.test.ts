import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdversarialEngine } from '../AdversarialEngine';
import type { AdversarialConfig, ModelConfig, RunRequest } from '@/lib/types';

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

  it('does not remove selected models just because they cannot use tools', async () => {
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

    await (engine as unknown as { prepareToolCapabilityMap: () => Promise<void> })
      .prepareToolCapabilityMap();

    const internals = engine as unknown as {
      options: { models: ModelConfig[] };
      modelMap: Map<string, ModelConfig>;
      toolCapableModelIds: Set<string>;
    };
    expect(internals.options.models.map(m => m.id)).toEqual(['tool-model', 'text-model', 'claude']);
    expect([...internals.modelMap.keys()]).toEqual(['tool-model', 'text-model', 'claude']);
    expect(internals.toolCapableModelIds.has('tool-model')).toBe(true);
    expect(internals.toolCapableModelIds.has('text-model')).toBe(false);
    expect(internals.toolCapableModelIds.has('claude')).toBe(false);
  });
});
