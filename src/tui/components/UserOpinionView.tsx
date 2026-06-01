import React from 'react';
import { Box, Text } from 'ink';
import { UserOpinionResult } from '@/lib/types';

interface Props {
  result?: UserOpinionResult;
}

export function UserOpinionView({ result }: Props) {
  if (!result || result.claims.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold color="cyan">用户意见评审</Text>
      <Text dimColor>{result.summary}</Text>
      {result.verdicts.slice(0, 4).map(v => {
        const claim = result.claims.find(c => c.id === v.claimId);
        const row = result.adoptionMatrix.find(r => r.claimId === v.claimId);
        return (
          <Box key={v.claimId} flexDirection="column">
            <Text>
              <Text color={statusColor(v.status)}>{statusLabel(v.status)}</Text>
              <Text> {v.claimId}: {claim?.text ?? ''}</Text>
            </Text>
            {row && (
              <Text dimColor>
                模型: {formatModelStances(row.byModel)}
                {row.evidenceStatuses.length > 0
                  ? ` | 证据: ${row.evidenceStatuses.map(e => `${e.ok ? 'ok' : e.status}`).join(', ')}`
                  : ''}
              </Text>
            )}
          </Box>
        );
      })}
      {result.sycophancySignals.length > 0 && (
        <Text color="yellow">附和风险: {result.sycophancySignals.length} 条</Text>
      )}
      {result.modelSycophancyScores.some(score => score.signalCount > 0) && (
        <Text color="yellow">
          投票惩罚: {result.modelSycophancyScores
            .filter(score => score.signalCount > 0)
            .map(score => `${score.modelId}×${score.penaltyMultiplier.toFixed(2)}`)
            .join(', ')}
        </Text>
      )}
    </Box>
  );
}

function formatModelStances(byModel: Record<string, string>): string {
  const entries = Object.entries(byModel);
  if (entries.length === 0) return '无';
  return entries.map(([modelId, stance]) => `${modelId}:${stance}`).join(', ');
}

function statusLabel(status: string): string {
  switch (status) {
    case 'adopted':
      return '[采纳]';
    case 'rejected':
      return '[反驳]';
    case 'partial':
      return '[部分]';
    default:
      return '[证据不足]';
  }
}

function statusColor(status: string): 'green' | 'red' | 'yellow' | 'gray' {
  switch (status) {
    case 'adopted':
      return 'green';
    case 'rejected':
      return 'red';
    case 'partial':
      return 'yellow';
    default:
      return 'gray';
  }
}
