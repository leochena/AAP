import { describe, expect, it } from 'vitest';
import { AdversarialEngine } from '../AdversarialEngine';
import type { AdversarialConfig, Challenge, EngineEvent, ModelConfig, ModelResponse, RunRequest } from '@/lib/types';

const adversarialConfig: AdversarialConfig = {
  autoChallenge: { enabled: true, threshold: 0.7, maxChallengesPerRound: 3 },
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

function model(id: string): ModelConfig {
  return {
    id,
    protocol: 'openai',
    baseUrl: 'http://example.com/v1',
    apiKey: 'sk-test',
    model: id,
    enabled: true,
  };
}

function response(modelId: string, content: string): ModelResponse {
  return { modelId, content, tokensIn: 0, tokensOut: 0, durationMs: 0 };
}

function challenge(round: number): Challenge {
  return {
    id: `c-${round}`,
    challengerId: 'm1',
    targetId: 'm2',
    type: 'factual-error',
    severity: 'high',
    targetSegment: 'claim',
    reason: `unresolved high-risk conflict in round ${round}`,
    confidence: 0.9,
    status: 'pending',
    timestamp: round,
  };
}

describe('AdversarialEngine structured deliberation', () => {
  it('builds the blackboard after blind answers and before auto-challenge', async () => {
    const request: RunRequest = {
      question: 'Which claim survives?',
      modelIds: ['m1', 'm2'],
      source: 'tui-input',
    };
    const engine = new AdversarialEngine({
      request,
      models: [model('m1'), model('m2')],
      adversarialConfig,
      storageDir: '/tmp/aap-test',
    });
    const eventOrder: string[] = [];
    engine.on('event', (event: EngineEvent) => {
      if (event.type === 'phase-change') {
        eventOrder.push(`phase:${(event.data as { phase: string }).phase}`);
      } else {
        eventOrder.push(event.type);
      }
    });

    (engine as unknown as { runGenerating: () => Promise<ModelResponse[]> }).runGenerating = async () => [
      response('m1', 'The filing is valid because the registry accepted the submission.'),
      response('m2', 'The filing is valid because the registry accepted the submission.'),
    ];
    (engine as unknown as { runAutoChallenge: () => Promise<[]> }).runAutoChallenge = async () => {
      expect(engine.snapshot.structuredDeliberation?.claims).toHaveLength(2);
      return [];
    };

    const result = await engine.run();

    expect(result.structuredDeliberation?.claims).toHaveLength(2);
    expect(result.structuredDeliberation?.consensusRisks[0]).toMatchObject({ severity: 'high' });
    expect(eventOrder.indexOf('phase:deliberation')).toBeLessThan(eventOrder.indexOf('deliberation-result'));
    expect(eventOrder.indexOf('deliberation-result')).toBeLessThan(eventOrder.indexOf('phase:auto-challenge'));
  });

  it('continues past the minimum round while high-severity challenges remain', async () => {
    const engine = new AdversarialEngine({
      request: {
        question: 'Which claim survives?',
        modelIds: ['m1', 'm2'],
        source: 'tui-input',
      },
      models: [model('m1'), model('m2')],
      adversarialConfig: {
        ...adversarialConfig,
        maxRounds: 4,
        roundControl: {
          minRounds: 2,
          continueOnHighSeverityChallenge: true,
          continueOnMediumSeverityChallenge: true,
          continueOnRequiredRevision: true,
        },
      },
      storageDir: '/tmp/aap-test',
    });
    let generationRounds = 0;
    (engine as unknown as { runGenerating: () => Promise<ModelResponse[]> }).runGenerating = async () => {
      generationRounds += 1;
      return [
        response('m1', `Round ${generationRounds}: The filing is valid because registry evidence supports it.`),
        response('m2', `Round ${generationRounds}: The filing is invalid because the signature evidence conflicts.`),
      ];
    };
    (engine as unknown as { runAutoChallenge: () => Promise<Challenge[]> }).runAutoChallenge = async () => {
      const round = engine.snapshot.currentRound ?? 1;
      return round < 3 ? [challenge(round)] : [];
    };

    const result = await engine.run();

    expect(generationRounds).toBe(3);
    expect(result.roundsCompleted).toBe(3);
    expect(result.roundStopReason).toBe('converged');
  });

  it('marks review required when max rounds are reached with unresolved conflicts', async () => {
    const engine = new AdversarialEngine({
      request: {
        question: 'Which claim survives?',
        modelIds: ['m1', 'm2'],
        source: 'tui-input',
      },
      models: [model('m1'), model('m2')],
      adversarialConfig: {
        ...adversarialConfig,
        maxRounds: 2,
        roundControl: {
          minRounds: 2,
          continueOnHighSeverityChallenge: true,
          continueOnMediumSeverityChallenge: true,
          continueOnRequiredRevision: true,
        },
      },
      storageDir: '/tmp/aap-test',
    });
    (engine as unknown as { runGenerating: () => Promise<ModelResponse[]> }).runGenerating = async () => [
      response('m1', 'The filing is valid because registry evidence supports it.'),
      response('m2', 'The filing is invalid because the signature evidence conflicts.'),
    ];
    (engine as unknown as { runAutoChallenge: () => Promise<Challenge[]> }).runAutoChallenge = async () => [
      challenge(engine.snapshot.currentRound ?? 1),
    ];

    const result = await engine.run();

    expect(result.roundsCompleted).toBe(2);
    expect(result.roundStopReason).toBe('max-rounds');
    expect(result.protocolOutput?.review.required).toBe(true);
    expect(result.protocolOutput?.review.reasons.join(' ')).toContain('maxRounds=2');
  });
});
