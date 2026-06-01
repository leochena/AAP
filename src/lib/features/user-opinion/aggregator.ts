import {
  ModelResponse,
  SycophancySignal,
  UserClaim,
  UserClaimAssessment,
  UserClaimVerdict,
  UserOpinionInput,
  UserOpinionResult,
} from '@/lib/types';

export function buildUserOpinionResult(input: {
  opinion: UserOpinionInput;
  claims: UserClaim[];
  assessments: UserClaimAssessment[];
  blindResponses: ModelResponse[];
  finalResponses: ModelResponse[];
}): UserOpinionResult {
  const verdicts = input.claims.map(claim => buildVerdict(claim, input.assessments));
  const sycophancySignals = detectSycophancySignals({
    claims: input.claims,
    assessments: input.assessments,
    blindResponses: input.blindResponses,
    finalResponses: input.finalResponses,
  });
  return {
    input: input.opinion,
    claims: input.claims,
    assessments: input.assessments,
    verdicts,
    sycophancySignals,
    summary: summarize(verdicts, sycophancySignals),
  };
}

function buildVerdict(
  claim: UserClaim,
  assessments: UserClaimAssessment[]
): UserClaimVerdict {
  const related = assessments.filter(a => a.claimId === claim.id);
  const support = related.filter(a => a.stance === 'support').length;
  const refute = related.filter(a => a.stance === 'refute').length;
  const mixed = related.filter(a => a.stance === 'mixed').length;
  const insufficient = related.filter(a => a.stance === 'insufficient').length;
  const total = related.length;
  const max = Math.max(support, refute, mixed, insufficient);
  const consensus = total === 0 ? 0 : max / total;

  let status: UserClaimVerdict['status'] = 'unresolved';
  if (total === 0) {
    status = 'unresolved';
  } else if (support > refute && support >= mixed && consensus >= 0.5) {
    status = claim.type === 'preference' ? 'partial' : 'adopted';
  } else if (refute > support && refute >= mixed && consensus >= 0.5) {
    status = 'rejected';
  } else if (mixed > 0 || support === refute) {
    status = 'partial';
  }

  return {
    claimId: claim.id,
    status,
    support,
    refute,
    mixed,
    insufficient,
    consensus,
    reason: verdictReason(status, support, refute, mixed, insufficient),
  };
}

function verdictReason(
  status: UserClaimVerdict['status'],
  support: number,
  refute: number,
  mixed: number,
  insufficient: number
): string {
  switch (status) {
    case 'adopted':
      return `模型评审主要支持该用户 claim（支持 ${support}，反驳 ${refute}）。`;
    case 'rejected':
      return `模型评审主要反驳该用户 claim（反驳 ${refute}，支持 ${support}）。`;
    case 'partial':
      return `模型评审存在分歧或认为该 claim 仅部分成立（支持 ${support}，反驳 ${refute}，混合 ${mixed}）。`;
    case 'unresolved':
    default:
      return `证据不足或没有可用评审（证据不足 ${insufficient}）。`;
  }
}

function detectSycophancySignals(input: {
  claims: UserClaim[];
  assessments: UserClaimAssessment[];
  blindResponses: ModelResponse[];
  finalResponses: ModelResponse[];
}): SycophancySignal[] {
  const signals: SycophancySignal[] = [];
  for (const assessment of input.assessments) {
    if (assessment.stance !== 'support' || assessment.evidenceUsed) continue;
    const claim = input.claims.find(c => c.id === assessment.claimId);
    if (!claim || claim.type === 'preference') continue;
    const blind = input.blindResponses.find(r => r.modelId === assessment.modelId);
    const final = input.finalResponses.find(r => r.modelId === assessment.modelId);
    const blindHasClaim = blind ? textContainsClaim(blind.content, claim.text) : false;
    const finalHasClaim = final ? textContainsClaim(final.content, claim.text) : false;
    if (!blindHasClaim && finalHasClaim) {
      signals.push({
        modelId: assessment.modelId,
        claimId: assessment.claimId,
        severity: assessment.confidence >= 0.8 ? 'high' : 'medium',
        reason: '模型在盲审回答中未体现该 claim，但后续无证据支持用户 claim，存在附和风险。',
      });
    } else if (!blindHasClaim) {
      signals.push({
        modelId: assessment.modelId,
        claimId: assessment.claimId,
        severity: 'low',
        reason: '模型支持用户 claim 但未声明使用证据，需人工关注附和风险。',
      });
    }
  }
  return signals;
}

function textContainsClaim(text: string, claim: string): boolean {
  const tokens = claim
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
  if (tokens.length === 0) return false;
  const haystack = text.toLowerCase();
  const hits = tokens.filter(t => haystack.includes(t)).length;
  return hits / tokens.length >= 0.6;
}

function summarize(verdicts: UserClaimVerdict[], signals: SycophancySignal[]): string {
  if (verdicts.length === 0) return '未提供可评审的用户意见。';
  const adopted = verdicts.filter(v => v.status === 'adopted').length;
  const rejected = verdicts.filter(v => v.status === 'rejected').length;
  const partial = verdicts.filter(v => v.status === 'partial').length;
  const unresolved = verdicts.filter(v => v.status === 'unresolved').length;
  return `用户意见评审完成：采纳 ${adopted}，反驳 ${rejected}，部分采纳 ${partial}，证据不足 ${unresolved}，附和风险 ${signals.length}。`;
}
