import { describe, expect, it } from 'vitest';
import { buildStructuredDeliberation } from '..';
import type { Challenge, ModelConfig, ModelResponse } from '@/lib/types';

function model(id: string, upstream = id): ModelConfig {
  return {
    id,
    protocol: 'openai',
    baseUrl: 'http://example.com/v1',
    apiKey: 'sk',
    model: upstream,
    enabled: true,
  };
}

function response(modelId: string, content: string): ModelResponse {
  return {
    modelId,
    content,
    tokensIn: 0,
    tokensOut: 0,
    durationMs: 0,
  };
}

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: 'c1',
    challengerId: 'm1',
    targetId: 'm2',
    type: 'factual-error',
    severity: 'high',
    targetSegment: 'accepted',
    reason: 'Registry acceptance was asserted without evidence.',
    confidence: 0.9,
    status: 'pending',
    timestamp: 1,
    ...overrides,
  };
}

describe('structured deliberation controller', () => {
  it('flags low-independence consensus and protects divergent minority claims', () => {
    const result = buildStructuredDeliberation({
      question: 'Who is correct?',
      models: [model('m1'), model('m2'), model('m3')],
      responses: [
        response('m1', 'The contract is valid because the filing was accepted.'),
        response('m2', 'The contract is valid because the filing was accepted.'),
        response('m3', 'The contract is not valid because the signature date conflicts with the filing date.'),
      ],
    });

    expect(result.claims).toHaveLength(3);
    expect(result.consensusRisks.some(signal => signal.severity === 'high')).toBe(true);
    expect(result.minorityProtection.map(signal => signal.modelId)).toContain('m3');
    expect(result.events.map(event => event.action)).toContain('protect_minority');
  });

  it('detects model identity drift from runtime identity', () => {
    const result = buildStructuredDeliberation({
      question: 'Identify yourself only if relevant',
      models: [model('opus-4.8', 'claude-opus-4-8')],
      responses: [
        response('opus-4.8', '我是通义千问模型。The answer is uncertain and needs evidence.'),
      ],
    });

    expect(result.identityDriftSignals).toEqual([
      expect.objectContaining({
        modelId: 'opus-4.8',
        claimedIdentity: 'Qwen/千问',
        severity: 'high',
      }),
    ]);
    expect(result.revisionDirectives.some(directive => directive.modelId === 'opus-4.8' && directive.required)).toBe(true);
  });

  it('updates the blackboard across rounds and converts challenges into revision directives', () => {
    const first = buildStructuredDeliberation({
      question: 'Who is correct?',
      round: 1,
      models: [model('m1'), model('m2')],
      responses: [
        response('m1', 'The contract is valid because the filing was accepted.'),
        response('m2', 'The contract is not valid because the filing date conflicts with signature evidence.'),
      ],
    });
    const second = buildStructuredDeliberation({
      question: 'Who is correct?',
      round: 2,
      previous: first,
      models: [model('m1'), model('m2')],
      responses: [
        response('m1', 'The contract validity remains uncertain without independent registry evidence.'),
        response('m2', 'The filing date conflict still needs document-level verification.'),
      ],
      challenges: [challenge()],
    });

    expect(second.rounds.map(round => round.round)).toEqual([1, 2]);
    expect(second.currentRound).toBe(2);
    expect(second.challengeRefs).toHaveLength(1);
    expect(second.revisionDirectives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          round: 2,
          modelId: 'm2',
          source: 'challenge',
          required: true,
        }),
      ])
    );
    expect(second.events.map(event => event.action)).toContain('register_challenge');
  });
});
