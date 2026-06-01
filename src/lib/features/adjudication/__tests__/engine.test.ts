import { describe, expect, it } from 'vitest';
import { adjudicateClaim } from '../engine';

describe('adjudication engine', () => {
  it('adopts a claim when reliable support dominates', () => {
    const decision = adjudicateClaim({
      claimId: 'c1',
      claimText: 'The claim is supported.',
      evidence: [
        {
          id: 'e1',
          source: 'primary',
          stance: 'support',
          confidence: 0.9,
          reliability: 0.95,
          recency: 0.9,
          scopeMatch: 1,
          summary: 'Primary source supports it.',
        },
      ],
    });

    expect(decision.conclusion).toBe('adopted');
    expect(decision.reviewRequired).toBe(false);
  });

  it('requires review for close direct conflicts', () => {
    const decision = adjudicateClaim({
      claimId: 'c2',
      claimText: 'The claim is contested.',
      evidence: [
        { id: 's', source: 'a', stance: 'support', confidence: 0.8, summary: 'supports' },
        { id: 'r', source: 'b', stance: 'refute', confidence: 0.75, summary: 'refutes' },
      ],
    });

    expect(decision.conclusion).toBe('unresolved');
    expect(decision.reviewRequired).toBe(true);
    expect(decision.rationale.join(' ')).toContain('conflict');
  });
});
