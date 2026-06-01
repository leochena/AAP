import { describe, expect, it } from 'vitest';
import { buildClaimGraphFromUserOpinion } from '../user-opinion-adapter';
import { extractEvidenceChains, summarizeClaimGraphQuality } from '../graph';
import { UserOpinionResult } from '@/lib/types';

describe('buildClaimGraphFromUserOpinion', () => {
  it('maps user opinion results into the generic claim graph primitive', () => {
    const result: UserOpinionResult = {
      input: { text: 'claim', evidenceUrls: ['https://example.com/e'] },
      claims: [{ id: 'uclaim-1', text: 'claim text', type: 'fact', evidenceUrls: ['https://example.com/e'] }],
      evidenceResults: [{ url: 'https://example.com/e', status: 'fetched', ok: true, preview: 'source text' }],
      assessments: [
        { modelId: 'm1', claimId: 'uclaim-1', stance: 'support', confidence: 0.8, evidenceUsed: true },
        { modelId: 'm2', claimId: 'uclaim-1', stance: 'refute', confidence: 0.6, evidenceUsed: true },
      ],
      verdicts: [
        {
          claimId: 'uclaim-1',
          status: 'partial',
          support: 1,
          refute: 1,
          mixed: 0,
          insufficient: 0,
          consensus: 0.5,
          reason: 'split',
        },
      ],
      sycophancySignals: [],
      modelSycophancyScores: [],
      adoptionMatrix: [],
      graph: { nodes: [], edges: [] },
      summary: 'summary',
    };

    const graph = buildClaimGraphFromUserOpinion({ userOpinion: result });
    const summary = summarizeClaimGraphQuality(graph);
    const chains = extractEvidenceChains(graph, 'user_claim:uclaim-1');

    expect(graph.nodes.some(node => node.type === 'user_claim')).toBe(true);
    expect(graph.nodes.some(node => node.type === 'model_claim')).toBe(true);
    expect(summary.supportCount).toBeGreaterThan(0);
    expect(summary.refuteCount).toBeGreaterThan(0);
    expect(chains).toHaveLength(1);
  });
});
