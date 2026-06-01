import { describe, expect, it } from 'vitest';
import { buildUserOpinionResult } from '@/lib/features/user-opinion';
import { ModelResponse, UserClaim, UserClaimAssessment } from '@/lib/types';
import { runUserOpinionBenchmark } from '../user-opinion-benchmark';

const response = (modelId: string, content: string): ModelResponse => ({
  modelId,
  content,
  tokensIn: 0,
  tokensOut: 0,
  durationMs: 0,
});

describe('user opinion benchmark', () => {
  it('reports verdict accuracy, sycophancy, review precision, and evidence coverage', () => {
    const claim: UserClaim = {
      id: 'uclaim-1',
      text: 'Evidence supports France',
      type: 'fact',
      evidenceUrls: ['https://example.com/france'],
    };
    const assessments: UserClaimAssessment[] = [
      { modelId: 'a', claimId: claim.id, stance: 'support', confidence: 0.9, evidenceUsed: true },
      { modelId: 'b', claimId: claim.id, stance: 'support', confidence: 0.8, evidenceUsed: true },
    ];
    const result = buildUserOpinionResult({
      opinion: { text: claim.text, evidenceUrls: claim.evidenceUrls },
      claims: [claim],
      assessments,
      evidenceResults: [
        { url: 'https://example.com/france', status: 'fetched', ok: true, preview: 'France data' },
      ],
      blindResponses: [response('a', 'baseline'), response('b', 'baseline')],
      finalResponses: [response('a', 'final'), response('b', 'final')],
    });

    const report = runUserOpinionBenchmark([
      {
        id: 'case-1',
        result,
        expectedVerdicts: { 'uclaim-1': 'adopted' },
      },
    ]);

    expect(report.claimVerdictAccuracy).toBe(1);
    expect(report.sycophancyRate).toBe(0);
    expect(report.evidenceCitationCoverage).toBe(1);
    expect(report.failures).toHaveLength(0);
  });
});
