import React from 'react';
import { Box, Text } from 'ink';
import { UIRunState } from '@/tui/hooks/useHub';
import { ModelPanel } from './ModelPanel';
import { PhaseIndicator } from './PhaseIndicator';
import { ToolCallView } from './ToolCallView';
import { ChallengeView } from './ChallengeView';
import { VoteView } from './VoteView';
import { UserOpinionView } from './UserOpinionView';
import { StructuredDeliberationView } from './StructuredDeliberationView';
import { ProtocolOutputView } from './ProtocolOutputView';

interface Props {
  run?: UIRunState;
  width: number;
  rows?: number;
}

export function RunDetailView({ run, width, rows }: Props) {
  if (!run) {
    return (
      <Box paddingX={1}>
        <Text dimColor>(选择一个 run 查看详情)</Text>
      </Box>
    );
  }

  const visibleIds = run.modelIds.length > 0
    ? run.modelIds
    : [...new Set([
        ...Object.keys(run.modelOutputs),
        ...Object.keys(run.modelErrors),
        ...Object.keys(run.modelDone),
      ])];
  // Reserve roughly 14 rows for header, run list, phase indicator, challenges,
  // votes, footer. Anything beyond that goes to per-model output, with a sane
  // floor so panels remain useful even on small terminals.
  const reserved = 14;
  const maxContentRows = rows ? Math.max(6, rows - reserved) : 12;

  return (
    <Box flexDirection="column">
      <Box paddingX={1} flexDirection="column">
        <Text bold>📝 {run.question}</Text>
        <Box marginTop={1}>
          <PhaseIndicator phase={run.phase} />
          {run.totalRounds && run.totalRounds > 1 && run.currentRound && (
            <Text>
              {'  '}
              <Text bold color="magenta">
                轮次 {run.currentRound}/{run.totalRounds}
              </Text>
            </Text>
          )}
        </Box>
      </Box>
      <ProtocolOutputView
        contract={run.protocolOutput}
        voting={run.voting}
        roundsCompleted={run.roundsCompleted}
        totalRounds={run.totalRounds}
        roundStopReason={run.roundStopReason}
        roundStopDetail={run.roundStopDetail}
      />
      {visibleIds.length > 0 && (
        <ModelPanel
          run={run}
          modelIds={visibleIds}
          width={width}
          maxContentRows={maxContentRows}
        />
      )}
      <ToolCallView toolCalls={run.toolCalls} withdrawals={run.withdrawals} />
      <StructuredDeliberationView result={run.structuredDeliberation} />
      <ChallengeView challenges={run.challenges} />
      <UserOpinionView result={run.userOpinion} />
      <VoteView result={run.voting} />
      {run.error && (
        <Box paddingX={1}>
          <Text color="red">错误: {run.error}</Text>
        </Box>
      )}
    </Box>
  );
}
