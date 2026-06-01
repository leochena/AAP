import { describe, expect, it } from 'vitest';
import { buildProtocolOutputContract, formatProtocolOutputContract } from '../contract';
import { ModelResponse, UserOpinionResult, VotingResult } from '@/lib/types';

function response(modelId: string, content: string): ModelResponse {
  return { modelId, content, tokensIn: 0, tokensOut: 0, durationMs: 0 };
}

describe('protocol output contract', () => {
  it('builds a required output contract from voting and user-opinion evidence', () => {
    const voting: VotingResult = {
      votes: [],
      totals: { a: 2, b: 1 },
      winner: 'a',
      consensusLevel: 0.66,
      isTie: false,
      isUnanimous: false,
      requiresReview: false,
    };
    const userOpinion: UserOpinionResult = {
      input: { text: 'claim', evidenceUrls: ['https://example.com'] },
      claims: [{ id: 'uclaim-1', text: 'claim', type: 'fact', evidenceUrls: ['https://example.com'] }],
      evidenceResults: [{ url: 'https://example.com', status: 'fetched', ok: true, preview: 'source text' }],
      assessments: [],
      verdicts: [
        {
          claimId: 'uclaim-1',
          status: 'adopted',
          support: 2,
          refute: 0,
          mixed: 0,
          insufficient: 0,
          consensus: 1,
          reason: 'supported',
        },
      ],
      sycophancySignals: [],
      modelSycophancyScores: [],
      adoptionMatrix: [],
      graph: { nodes: [], edges: [] },
      summary: 'ok',
    };

    const contract = buildProtocolOutputContract({
      responses: [response('a', 'final answer'), response('b', 'other answer')],
      challenges: [],
      voting,
      userOpinion,
    });

    expect(contract.conclusion).toBe('final answer');
    expect(contract.confidence).toBeCloseTo(0.66);
    expect(contract.evidenceChain[0]).toMatchObject({ status: 'supporting' });
    expect(contract.userClaims[0]).toMatchObject({ decision: 'adopted' });
    expect(formatProtocolOutputContract(contract)).toContain('协议裁决契约');
  });

  it('surfaces review reasons for low consensus and high sycophancy', () => {
    const contract = buildProtocolOutputContract({
      responses: [response('a', 'answer'), { ...response('b', ''), error: 'timeout' }],
      challenges: [{ id: 'c1', challengerId: 'a', targetId: 'b', type: 'factual-error', severity: 'high', targetSegment: 'x', reason: 'wrong source', confidence: 0.9, status: 'pending', timestamp: 0 }],
      voting: {
        votes: [],
        totals: { a: 1, b: 1 },
        consensusLevel: 0.5,
        isTie: true,
        isUnanimous: false,
        requiresReview: true,
      },
      userOpinion: {
        input: { text: 'claim' },
        claims: [{ id: 'uclaim-1', text: 'claim', type: 'fact', evidenceUrls: [] }],
        evidenceResults: [],
        assessments: [],
        verdicts: [{ claimId: 'uclaim-1', status: 'unresolved', support: 0, refute: 0, mixed: 0, insufficient: 1, consensus: 1, reason: 'insufficient' }],
        sycophancySignals: [{ modelId: 'a', claimId: 'uclaim-1', severity: 'high', reason: 'unsupported agreement' }],
        modelSycophancyScores: [{ modelId: 'a', signalCount: 1, maxSeverity: 'high', penaltyMultiplier: 0.5, reason: 'risk' }],
        adoptionMatrix: [],
        graph: { nodes: [], edges: [] },
        summary: 'risk',
      },
    });

    expect(contract.review.required).toBe(true);
    expect(contract.review.reasons.join(' ')).toContain('附和风险');
    expect(contract.conflictPoints[0]).toMatchObject({ severity: 'high' });
  });
});
