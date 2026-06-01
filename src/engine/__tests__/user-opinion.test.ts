import { describe, expect, it } from 'vitest';
import { AdversarialEngine } from '../AdversarialEngine';
import type { AdversarialConfig, Challenge, ModelConfig, ModelResponse, RunRequest } from '@/lib/types';

const adversarialConfig: AdversarialConfig = {
  autoChallenge: { enabled: false, threshold: 0.7, maxChallengesPerRound: 3 },
  voting: { enabled: false, mode: 'weighted', threshold: 0.5, tiebreaker: 'first' },
  maxRounds: 2,
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

const model: ModelConfig = {
  id: 'm1',
  protocol: 'openai',
  baseUrl: 'http://example.com/v1',
  apiKey: 'sk',
  model: 'mock',
  enabled: true,
};

const request: RunRequest = {
  question: 'Who will win?',
  modelIds: ['m1'],
  source: 'tui-input',
  userOpinion: {
    text: '我认为法国会夺冠。证据 https://example.com/france',
  },
};

describe('AdversarialEngine user opinion prompts', () => {
  it('keeps the first pass blind and injects user opinion only into refinement', () => {
    const engine = new AdversarialEngine({
      request,
      models: [model],
      adversarialConfig,
      storageDir: '/tmp/aap-test',
    });

    const system = (engine as unknown as { buildSystemMessage: () => { content: string } })
      .buildSystemMessage();
    expect(system.content).not.toContain('法国会夺冠');

    const refinement = (engine as unknown as {
      buildRefinementMessage: (responses: ModelResponse[], challenges: Challenge[]) => string;
    }).buildRefinementMessage(
      [{ modelId: 'm1', content: 'Brazil is a contender.', tokensIn: 0, tokensOut: 0, durationMs: 0 }],
      []
    );
    expect(refinement).toContain('用户意见（待验证');
    expect(refinement).toContain('法国会夺冠');
    expect(refinement).toContain('不是投票权');
  });
});
