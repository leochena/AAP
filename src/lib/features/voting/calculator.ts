/**
 * 投票计算器
 */

import { Vote, VotingResult, ModelConfig, AdversarialConfig } from '@/lib/types';

export interface VotingCalcOptions {
  votes: Vote[];
  options: string[];                // 候选 modelId 列表
  models: Map<string, ModelConfig>; // modelId → ModelConfig（取 weight 用）
  config: AdversarialConfig['voting'];
  voteWeights?: Record<string, number>;
}

export function calculateVotingResult(opts: VotingCalcOptions): VotingResult {
  const { votes, options, models, config } = opts;

  const totals: Record<string, number> = {};
  options.forEach(o => (totals[o] = 0));

  votes.forEach(v => {
    if (totals[v.choice] === undefined) return;
    const adjustedWeight = opts.voteWeights?.[v.voterId];
    const weight =
      adjustedWeight !== undefined
        ? adjustedWeight
        : config.mode === 'majority'
          ? 1
          : models.get(v.voterId)?.weight ?? 1.0;
    totals[v.choice] += weight;
  });

  const entries = Object.entries(totals);
  const maxScore = entries.length > 0 ? Math.max(...entries.map(([, s]) => s)) : 0;
  const winners = entries.filter(([, s]) => s === maxScore && s > 0).map(([k]) => k);

  const isTie = winners.length > 1;
  const winner =
    winners.length === 0
      ? undefined
      : isTie
        ? handleTie(winners, config.tiebreaker)
        : winners[0];

  const totalScore = entries.reduce((sum, [, s]) => sum + s, 0);
  const consensusLevel = computeConsensus(totals, totalScore, votes.length, config);
  const isUnanimous =
    winner !== undefined && votes.length > 0 && votes.every(v => v.choice === winner);

  const requiresReview =
    isTie || consensusLevel < config.threshold || votes.length < 2;

  return {
    votes,
    totals,
    winner,
    consensusLevel,
    isTie,
    isUnanimous,
    requiresReview,
  };
}

function handleTie(
  winners: string[],
  tiebreaker: 'first' | 'random' | 'abstain'
): string | undefined {
  switch (tiebreaker) {
    case 'first':
      return winners[0];
    case 'random':
      return winners[Math.floor(Math.random() * winners.length)];
    case 'abstain':
      return undefined;
  }
}

function computeConsensus(
  totals: Record<string, number>,
  totalScore: number,
  voteCount: number,
  config: AdversarialConfig['voting']
): number {
  if (totalScore === 0 || voteCount === 0) return 0;
  const maxScore = Math.max(...Object.values(totals));

  switch (config.mode) {
    case 'unanimous':
      return maxScore === totalScore ? 1 : maxScore / totalScore;
    case 'consensus': {
      const aboveThreshold = Object.values(totals).filter(
        v => v / totalScore >= config.threshold
      ).length;
      return aboveThreshold > 0 ? maxScore / totalScore : 0;
    }
    case 'majority':
    case 'weighted':
    default:
      return maxScore / totalScore;
  }
}
