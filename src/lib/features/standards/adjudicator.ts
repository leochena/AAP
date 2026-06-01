export type RequirementLevel = 'mandatory' | 'recommended' | 'informational';
export type StandardsConflictType =
  | 'true-conflict'
  | 'different-scope'
  | 'definition-only'
  | 'transition-period';

export interface StandardClause {
  id: string;
  documentId: string;
  title: string;
  text: string;
  scope: string[];
  requirementLevel: RequirementLevel;
  authorityRank: number;
  specificity: number;
  effectiveDate: string;
  publishedDate?: string;
  replaces?: string[];
  replacedBy?: string;
  transitionEndDate?: string;
  isDefinition?: boolean;
}

export interface StandardsContext {
  scope: string[];
  asOfDate: string;
  jurisdiction?: string;
}

export interface StandardsAdjudicationResult {
  conflictType: StandardsConflictType;
  selectedClause?: StandardClause;
  alternatives: StandardClause[];
  conclusion: string;
  rationale: string[];
  needsReview: boolean;
}

export function adjudicateStandardsConflict(input: {
  clauses: StandardClause[];
  context: StandardsContext;
}): StandardsAdjudicationResult {
  const applicable = input.clauses
    .map(clause => ({ clause, score: scoreClause(clause, input.context) }))
    .filter(row => row.score.scopeScore > 0 && isEffective(row.clause, input.context.asOfDate));

  if (applicable.length === 0) {
    return {
      conflictType: 'different-scope',
      alternatives: [],
      conclusion: '没有条款同时匹配当前适用范围与日期。',
      rationale: ['所有候选条款均不适用于给定场景，不能强行裁决。'],
      needsReview: true,
    };
  }

  if (applicable.every(row => row.clause.isDefinition)) {
    return {
      conflictType: 'definition-only',
      selectedClause: applicable[0].clause,
      alternatives: applicable.slice(1).map(row => row.clause),
      conclusion: '候选条款主要是术语定义差异，不构成直接事实裁决冲突。',
      rationale: ['应先确认术语边界，再判断实体要求是否冲突。'],
      needsReview: applicable.length > 1,
    };
  }

  const transitionRows = applicable.filter(row => isInTransition(row.clause, input.context.asOfDate));
  const conflictType: StandardsConflictType =
    transitionRows.length > 0
      ? 'transition-period'
      : applicable.length < input.clauses.length
        ? 'different-scope'
        : 'true-conflict';

  const ranked = applicable
    .slice()
    .sort((a, b) => totalScore(b.score) - totalScore(a.score));
  const winner = ranked[0];
  const second = ranked[1];
  const close = second ? totalScore(winner.score) - totalScore(second.score) < 5 : false;

  return {
    conflictType,
    selectedClause: winner.clause,
    alternatives: ranked.slice(1).map(row => row.clause),
    conclusion: `${winner.clause.documentId} / ${winner.clause.id} 在当前场景下优先适用。`,
    rationale: [
      `适用范围匹配分 ${winner.score.scopeScore.toFixed(1)}。`,
      `效力层级 ${winner.clause.authorityRank}，要求等级 ${winner.clause.requirementLevel}，专门性 ${winner.clause.specificity}。`,
      `生效日期 ${winner.clause.effectiveDate}${winner.clause.transitionEndDate ? `，过渡期至 ${winner.clause.transitionEndDate}` : ''}。`,
      ...replacementRationale(winner.clause, input.clauses),
    ],
    needsReview: close || conflictType === 'transition-period',
  };
}

interface ClauseScore {
  scopeScore: number;
  authorityScore: number;
  requirementScore: number;
  specificityScore: number;
  recencyScore: number;
  replacementScore: number;
}

function scoreClause(clause: StandardClause, context: StandardsContext): ClauseScore {
  return {
    scopeScore: scopeScore(clause.scope, context.scope),
    authorityScore: clause.authorityRank * 100,
    requirementScore: clause.requirementLevel === 'mandatory' ? 30 : clause.requirementLevel === 'recommended' ? 10 : 0,
    specificityScore: clause.specificity * 12,
    recencyScore: daysSinceEpoch(clause.effectiveDate) / 3650,
    replacementScore: clause.replacedBy ? -50 : clause.replaces && clause.replaces.length > 0 ? 15 : 0,
  };
}

function totalScore(score: ClauseScore): number {
  return (
    score.scopeScore * 20 +
    score.authorityScore +
    score.requirementScore +
    score.specificityScore +
    score.recencyScore +
    score.replacementScore
  );
}

function scopeScore(clauseScope: string[], contextScope: string[]): number {
  if (clauseScope.length === 0 || contextScope.length === 0) return 0.5;
  const normalized = new Set(clauseScope.map(s => s.toLowerCase()));
  const hits = contextScope.filter(s => normalized.has(s.toLowerCase())).length;
  return hits / contextScope.length;
}

function isEffective(clause: StandardClause, asOfDate: string): boolean {
  return daysSinceEpoch(clause.effectiveDate) <= daysSinceEpoch(asOfDate);
}

function isInTransition(clause: StandardClause, asOfDate: string): boolean {
  if (!clause.transitionEndDate) return false;
  const date = daysSinceEpoch(asOfDate);
  return date >= daysSinceEpoch(clause.effectiveDate) && date <= daysSinceEpoch(clause.transitionEndDate);
}

function replacementRationale(selected: StandardClause, all: StandardClause[]): string[] {
  const replaced = all.filter(clause => selected.replaces?.includes(clause.id));
  if (replaced.length === 0) return [];
  return [`该条款声明替代 ${replaced.map(clause => clause.id).join(', ')}。`];
}

function daysSinceEpoch(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? ms / 86400000 : 0;
}
