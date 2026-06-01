import {
  Challenge,
  ModelResponse,
  ProtocolConflictPoint,
  ProtocolEvidenceChainItem,
  ProtocolOutputContract,
  ProtocolReviewState,
  ProtocolSycophancyRisk,
  ProtocolUserClaimDecision,
  StructuredDeliberationResult,
  UserOpinionResult,
  VotingResult,
} from '@/lib/types';

export interface BuildProtocolOutputInput {
  responses: ModelResponse[];
  challenges: Challenge[];
  structuredDeliberation?: StructuredDeliberationResult;
  voting?: VotingResult;
  userOpinion?: UserOpinionResult;
}

export function buildProtocolOutputContract(
  input: BuildProtocolOutputInput
): ProtocolOutputContract {
  const conclusion = buildConclusion(input.responses, input.voting);
  const confidence = estimateConfidence(input.voting, input.userOpinion);
  const evidenceChain = buildEvidenceChain(input.userOpinion);
  const conflictPoints = buildConflictPoints(input.challenges, input.userOpinion, input.structuredDeliberation);
  const userClaims = buildUserClaimDecisions(input.userOpinion);
  const sycophancyRisks = buildSycophancyRisks(input.userOpinion);
  const review = buildReviewState({
    voting: input.voting,
    responses: input.responses,
    userOpinion: input.userOpinion,
    structuredDeliberation: input.structuredDeliberation,
    conflictPoints,
    sycophancyRisks,
    evidenceChain,
  });

  return {
    conclusion,
    confidence,
    evidenceChain,
    conflictPoints,
    userClaims,
    sycophancyRisks,
    review,
  };
}

export function formatProtocolOutputContract(contract?: ProtocolOutputContract): string {
  if (!contract) return '';
  const lines: string[] = [
    '## 协议裁决契约',
    '',
    `结论: ${contract.conclusion}`,
    `置信度: ${(contract.confidence * 100).toFixed(1)}%`,
    `需复核: ${contract.review.required ? '是' : '否'}`,
  ];
  if (contract.review.reasons.length > 0) {
    lines.push(`复核原因: ${contract.review.reasons.join('；')}`);
  }
  if (contract.evidenceChain.length > 0) {
    lines.push('', '### 证据链');
    for (const item of contract.evidenceChain.slice(0, 8)) {
      lines.push(`- [${item.status}] ${item.source}: ${item.summary}`);
    }
  }
  if (contract.conflictPoints.length > 0) {
    lines.push('', '### 冲突点');
    for (const point of contract.conflictPoints.slice(0, 8)) {
      lines.push(`- [${point.severity}] ${point.source}: ${point.summary}`);
    }
  }
  if (contract.sycophancyRisks.length > 0) {
    lines.push('', '### 附和风险');
    for (const risk of contract.sycophancyRisks.slice(0, 8)) {
      lines.push(`- [${risk.severity}] ${risk.modelId}: ${risk.reason}`);
    }
  }
  return lines.join('\n');
}

function buildConclusion(responses: ModelResponse[], voting?: VotingResult): string {
  if (voting?.winner) {
    const winner = responses.find(r => r.modelId === voting.winner);
    const content = winner?.content?.trim();
    if (content) return truncate(content, 900);
    return `投票获胜模型：${voting.winner}`;
  }
  const succeeded = responses.filter(r => !r.error && r.content.trim());
  if (succeeded.length === 1) return truncate(succeeded[0].content.trim(), 900);
  if (succeeded.length > 1) return '多模型存在可用回答，但未形成明确获胜结论。';
  return '没有可用模型回答。';
}

function estimateConfidence(voting?: VotingResult, userOpinion?: UserOpinionResult): number {
  if (voting) {
    const penalty = voting.requiresReview ? 0.85 : 1;
    return clamp01(voting.consensusLevel * penalty);
  }
  const verdicts = userOpinion?.verdicts ?? [];
  if (verdicts.length === 0) return 0.5;
  return clamp01(verdicts.reduce((sum, v) => sum + v.consensus, 0) / verdicts.length);
}

function buildEvidenceChain(userOpinion?: UserOpinionResult): ProtocolEvidenceChainItem[] {
  if (!userOpinion) return [];
  const verdictByClaim = new Map(userOpinion.verdicts.map(v => [v.claimId, v]));
  return userOpinion.evidenceResults.map((evidence, index) => {
    const relatedClaim = userOpinion.claims.find(claim => claim.evidenceUrls.includes(evidence.url));
    const verdict = relatedClaim ? verdictByClaim.get(relatedClaim.id) : undefined;
    return {
      id: `evidence-${index + 1}`,
      source: evidence.url,
      url: evidence.url,
      summary: evidence.ok
        ? truncate(evidence.preview ?? evidence.title ?? evidence.url, 220)
        : evidence.error ?? '证据未能验证',
      status: evidence.ok
        ? verdict?.status === 'rejected'
          ? 'refuting'
          : verdict?.status === 'partial'
            ? 'qualifying'
            : 'supporting'
        : 'unverified',
      confidence: evidence.ok ? 0.75 : 0.2,
    };
  });
}

function buildConflictPoints(
  challenges: Challenge[],
  userOpinion?: UserOpinionResult,
  structuredDeliberation?: StructuredDeliberationResult
): ProtocolConflictPoint[] {
  const challengePoints = challenges
    .filter(c => c.severity !== 'low')
    .map(c => ({
      id: `challenge-${c.id}`,
      source: `${c.challengerId}->${c.targetId}`,
      summary: c.reason,
      severity: c.severity,
    }));
  const claimPoints = (userOpinion?.verdicts ?? [])
    .filter(v => v.status === 'partial' || v.status === 'unresolved')
    .map(v => ({
      id: `claim-${v.claimId}`,
      source: v.claimId,
      summary: v.reason,
      severity: v.status === 'unresolved' ? 'medium' as const : 'low' as const,
    }));
  const deliberationPoints: ProtocolConflictPoint[] = [
    ...(structuredDeliberation?.identityDriftSignals ?? []).map(signal => ({
      id: `identity-${signal.id}`,
      source: signal.modelId,
      summary: signal.reason,
      severity: signal.severity,
    })),
    ...(structuredDeliberation?.consensusRisks ?? []).map(signal => ({
      id: `consensus-${signal.id}`,
      source: signal.clusterId,
      summary: signal.reason,
      severity: signal.severity,
    })),
    ...(structuredDeliberation?.minorityProtection ?? []).map(signal => ({
      id: `minority-${signal.id}`,
      source: signal.modelId,
      summary: signal.reason,
      severity: signal.severity,
    })),
  ];
  return [...challengePoints, ...claimPoints, ...deliberationPoints];
}

function buildUserClaimDecisions(userOpinion?: UserOpinionResult): ProtocolUserClaimDecision[] {
  if (!userOpinion) return [];
  return userOpinion.verdicts.map(verdict => {
    const claim = userOpinion.claims.find(c => c.id === verdict.claimId);
    return {
      claimId: verdict.claimId,
      claimText: claim?.text ?? verdict.claimId,
      decision: verdict.status,
      reason: verdict.reason,
    };
  });
}

function buildSycophancyRisks(userOpinion?: UserOpinionResult): ProtocolSycophancyRisk[] {
  if (!userOpinion) return [];
  return userOpinion.sycophancySignals.map(signal => {
    const score = userOpinion.modelSycophancyScores.find(s => s.modelId === signal.modelId);
    return {
      modelId: signal.modelId,
      claimId: signal.claimId,
      severity: signal.severity,
      penaltyMultiplier: score?.penaltyMultiplier,
      reason: signal.reason,
    };
  });
}

function buildReviewState(input: {
  voting?: VotingResult;
  responses: ModelResponse[];
  userOpinion?: UserOpinionResult;
  structuredDeliberation?: StructuredDeliberationResult;
  conflictPoints: ProtocolConflictPoint[];
  sycophancyRisks: ProtocolSycophancyRisk[];
  evidenceChain: ProtocolEvidenceChainItem[];
}): ProtocolReviewState {
  const reasons: string[] = [];
  if (input.voting?.requiresReview) reasons.push('投票共识不足或平局');
  if (input.responses.some(r => r.error)) reasons.push('部分模型调用失败');
  if (input.conflictPoints.some(p => p.severity === 'high')) reasons.push('存在高严重性模型互相挑战');
  if ((input.userOpinion?.verdicts ?? []).some(v => v.status === 'unresolved')) {
    reasons.push('用户 claim 存在证据不足');
  }
  if (input.sycophancyRisks.some(r => r.severity === 'high')) reasons.push('存在高附和风险');
  if ((input.structuredDeliberation?.identityDriftSignals ?? []).length > 0) {
    reasons.push('存在模型身份漂移信号');
  }
  if ((input.structuredDeliberation?.consensusRisks ?? []).some(r => r.severity !== 'low')) {
    reasons.push('存在低独立性共识风险');
  }
  if ((input.structuredDeliberation?.minorityProtection ?? []).length > 0) {
    reasons.push('存在需要保护的少数派论断');
  }
  if ((input.userOpinion?.claims ?? []).some(c => c.evidenceUrls.length > 0) && input.evidenceChain.length === 0) {
    reasons.push('用户提供证据链接但未形成可用证据链');
  }
  return {
    required: reasons.length > 0,
    reasons,
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
