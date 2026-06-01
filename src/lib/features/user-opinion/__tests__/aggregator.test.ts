import { describe, expect, it } from 'vitest';
import { buildUserOpinionResult } from '../aggregator';
import { ModelResponse, UserClaim, UserClaimAssessment } from '@/lib/types';

function response(modelId: string, content: string): ModelResponse {
  return { modelId, content, tokensIn: 0, tokensOut: 0, durationMs: 0 };
}

const claim: UserClaim = {
  id: 'uclaim-1',
  text: 'France will win the tournament',
  type: 'hypothesis',
  evidenceUrls: [],
};

describe('user opinion aggregator', () => {
  it('adopts a claim when assessments mainly support it', () => {
    const assessments: UserClaimAssessment[] = [
      { modelId: 'a', claimId: claim.id, stance: 'support', confidence: 0.8, evidenceUsed: true },
      { modelId: 'b', claimId: claim.id, stance: 'support', confidence: 0.7, evidenceUsed: true },
      { modelId: 'c', claimId: claim.id, stance: 'insufficient', confidence: 0.6, evidenceUsed: false },
    ];
    const result = buildUserOpinionResult({
      opinion: { text: claim.text },
      claims: [claim],
      assessments,
      blindResponses: [response('a', 'baseline'), response('b', 'baseline'), response('c', 'baseline')],
      finalResponses: [response('a', 'final'), response('b', 'final'), response('c', 'final')],
    });
    expect(result.verdicts[0].status).toBe('adopted');
    expect(result.summary).toContain('采纳 1');
  });

  it('flags sycophancy when a model supports a factual claim without evidence after blind silence', () => {
    const assessments: UserClaimAssessment[] = [
      { modelId: 'a', claimId: claim.id, stance: 'support', confidence: 0.9, evidenceUsed: false },
    ];
    const result = buildUserOpinionResult({
      opinion: { text: claim.text },
      claims: [claim],
      assessments,
      blindResponses: [response('a', 'Brazil and Argentina are stronger candidates.')],
      finalResponses: [response('a', 'France will win the tournament.')],
    });
    expect(result.sycophancySignals).toHaveLength(1);
    expect(result.sycophancySignals[0]).toMatchObject({ modelId: 'a', severity: 'high' });
  });

  it('does not flag preference claims as sycophancy', () => {
    const preference: UserClaim = { ...claim, type: 'preference', text: 'I prefer lower risk' };
    const result = buildUserOpinionResult({
      opinion: { text: preference.text },
      claims: [preference],
      assessments: [
        { modelId: 'a', claimId: preference.id, stance: 'support', confidence: 0.9, evidenceUsed: false },
      ],
      blindResponses: [response('a', 'baseline')],
      finalResponses: [response('a', 'I prefer lower risk')],
    });
    expect(result.sycophancySignals).toHaveLength(0);
    expect(result.verdicts[0].status).toBe('partial');
  });
});
