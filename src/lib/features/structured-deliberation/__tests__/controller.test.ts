import { describe, expect, it } from 'vitest';
import { buildStructuredDeliberation } from '..';
import type { ModelConfig, ModelResponse } from '@/lib/types';

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
});
