export type AdjudicationStance = 'support' | 'refute' | 'qualify' | 'insufficient';

export interface AdjudicationEvidence {
  id: string;
  source: string;
  stance: AdjudicationStance;
  confidence: number;
  reliability?: number;
  recency?: number;
  scopeMatch?: number;
  summary: string;
}

export interface AdjudicationInput {
  claimId: string;
  claimText: string;
  evidence: AdjudicationEvidence[];
  threshold?: number;
}

export interface AdjudicationDecision {
  claimId: string;
  conclusion: 'adopted' | 'rejected' | 'partial' | 'unresolved';
  confidence: number;
  supportScore: number;
  refuteScore: number;
  qualifyingScore: number;
  rationale: string[];
  reviewRequired: boolean;
}

export function adjudicateClaim(input: AdjudicationInput): AdjudicationDecision {
  const threshold = input.threshold ?? 0.62;
  const supportScore = scoreEvidence(input.evidence, 'support');
  const refuteScore = scoreEvidence(input.evidence, 'refute');
  const qualifyingScore = scoreEvidence(input.evidence, 'qualify');
  const total = supportScore + refuteScore + qualifyingScore;
  const top = Math.max(supportScore, refuteScore, qualifyingScore);
  const confidence = total === 0 ? 0 : clamp01(top / total);
  const conflictGap = Math.abs(supportScore - refuteScore);
  const hasDirectConflict = supportScore > 0 && refuteScore > 0 && conflictGap < Math.max(0.2, top * 0.35);

  let conclusion: AdjudicationDecision['conclusion'] = 'unresolved';
  if (total === 0 || confidence < threshold) {
    conclusion = 'unresolved';
  } else if (hasDirectConflict || qualifyingScore >= top * 0.8) {
    conclusion = 'partial';
  } else if (supportScore > refuteScore) {
    conclusion = 'adopted';
  } else if (refuteScore > supportScore) {
    conclusion = 'rejected';
  }

  const rationale = [
    `support=${supportScore.toFixed(3)}`,
    `refute=${refuteScore.toFixed(3)}`,
    `qualify=${qualifyingScore.toFixed(3)}`,
  ];
  if (hasDirectConflict) rationale.push('direct support/refute conflict detected');
  if (input.evidence.some(e => e.stance === 'insufficient')) {
    rationale.push('some evidence was marked insufficient');
  }

  return {
    claimId: input.claimId,
    conclusion,
    confidence,
    supportScore,
    refuteScore,
    qualifyingScore,
    rationale,
    reviewRequired: conclusion === 'unresolved' || hasDirectConflict,
  };
}

export function adjudicateClaims(
  inputs: AdjudicationInput[]
): AdjudicationDecision[] {
  return inputs.map(input => adjudicateClaim(input));
}

function scoreEvidence(
  evidence: AdjudicationEvidence[],
  stance: Exclude<AdjudicationStance, 'insufficient'>
): number {
  return evidence
    .filter(item => item.stance === stance)
    .reduce((sum, item) => {
      const reliability = item.reliability ?? 0.65;
      const recency = item.recency ?? 0.6;
      const scope = item.scopeMatch ?? 0.7;
      return sum + clamp01(item.confidence) * clamp01(reliability) * clamp01(recency) * clamp01(scope);
    }, 0);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
