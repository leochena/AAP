import { describe, expect, it } from 'vitest';
import { adjudicateStandardsConflict, StandardClause } from '../adjudicator';

const base: StandardClause = {
  id: 'old-1',
  documentId: 'STD-OLD',
  title: 'Old rule',
  text: 'Old limit',
  scope: ['building'],
  requirementLevel: 'mandatory',
  authorityRank: 2,
  specificity: 0.5,
  effectiveDate: '2020-01-01',
};

describe('standards conflict adjudication', () => {
  it('prefers higher authority mandatory clauses', () => {
    const result = adjudicateStandardsConflict({
      context: { scope: ['building'], asOfDate: '2026-01-01' },
      clauses: [
        base,
        { ...base, id: 'higher', documentId: 'LAW', authorityRank: 5, title: 'Higher law' },
      ],
    });

    expect(result.selectedClause?.id).toBe('higher');
    expect(result.conflictType).toBe('true-conflict');
  });

  it('distinguishes different scope from direct conflict', () => {
    const result = adjudicateStandardsConflict({
      context: { scope: ['medical'], asOfDate: '2026-01-01' },
      clauses: [base, { ...base, id: 'medical', documentId: 'MED', scope: ['medical'] }],
    });

    expect(result.selectedClause?.id).toBe('medical');
    expect(result.conflictType).toBe('different-scope');
  });

  it('marks transition period conflicts for review', () => {
    const result = adjudicateStandardsConflict({
      context: { scope: ['building'], asOfDate: '2026-03-01' },
      clauses: [
        base,
        {
          ...base,
          id: 'new-1',
          documentId: 'STD-NEW',
          title: 'New rule',
          effectiveDate: '2026-01-01',
          transitionEndDate: '2026-12-31',
          replaces: ['old-1'],
        },
      ],
    });

    expect(result.conflictType).toBe('transition-period');
    expect(result.needsReview).toBe(true);
  });

  it('prefers mandatory over recommended language at the same authority level', () => {
    const result = adjudicateStandardsConflict({
      context: { scope: ['building'], asOfDate: '2026-01-01' },
      clauses: [
        { ...base, id: 'recommended', requirementLevel: 'recommended' },
        { ...base, id: 'mandatory', requirementLevel: 'mandatory' },
      ],
    });

    expect(result.selectedClause?.id).toBe('mandatory');
  });

  it('prefers specific clauses over general clauses when authority is equal', () => {
    const result = adjudicateStandardsConflict({
      context: { scope: ['building', 'fire-safety'], asOfDate: '2026-01-01' },
      clauses: [
        { ...base, id: 'general', scope: ['building'], specificity: 0.2 },
        { ...base, id: 'specific', scope: ['building', 'fire-safety'], specificity: 0.9 },
      ],
    });

    expect(result.selectedClause?.id).toBe('specific');
  });

  it('separates definition-only differences', () => {
    const result = adjudicateStandardsConflict({
      context: { scope: ['building'], asOfDate: '2026-01-01' },
      clauses: [
        { ...base, id: 'def-a', isDefinition: true },
        { ...base, id: 'def-b', documentId: 'STD-B', isDefinition: true },
      ],
    });

    expect(result.conflictType).toBe('definition-only');
  });
});
