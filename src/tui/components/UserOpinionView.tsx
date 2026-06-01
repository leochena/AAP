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
        return (
          <Text key={v.claimId}>
            <Text color={statusColor(v.status)}>{statusLabel(v.status)}</Text>
            <Text> {v.claimId}: {claim?.text ?? ''}</Text>
          </Text>
        );
      })}
      {result.sycophancySignals.length > 0 && (
        <Text color="yellow">附和风险: {result.sycophancySignals.length} 条</Text>
      )}
    </Box>
  );
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
