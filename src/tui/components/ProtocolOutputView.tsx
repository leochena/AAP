import React from 'react';
import { Box, Text } from 'ink';
import { ProtocolOutputContract, RunSnapshot, VotingResult } from '@/lib/types';

interface Props {
  contract?: ProtocolOutputContract;
  voting?: VotingResult;
  roundsCompleted?: number;
  totalRounds?: number;
  roundStopReason?: RunSnapshot['roundStopReason'];
  roundStopDetail?: string;
  reportPath?: string;
}

export function ProtocolOutputView({
  contract,
  voting,
  roundsCompleted,
  totalRounds,
  roundStopReason,
  roundStopDetail,
  reportPath,
}: Props) {
  if (!contract && !voting && !reportPath) return null;

  const reviewRequired = contract?.review.required ?? voting?.requiresReview ?? false;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={reviewRequired ? 'yellow' : 'cyan'} paddingX={1}>
      <Text bold color={reviewRequired ? 'yellow' : 'cyan'}>最终求真结果</Text>
      {voting?.winner && (
        <Text>
          暂定代表答案: <Text color="cyan" bold>{voting.winner}</Text>
          <Text dimColor>，不是“真相保证”，只表示当前协议投票排序第一</Text>
        </Text>
      )}
      {contract && (
        <>
          <Text>
            置信度: <Text bold>{(contract.confidence * 100).toFixed(1)}%</Text>
            <Text>  需复核: </Text>
            <Text color={contract.review.required ? 'yellow' : 'green'} bold>
              {contract.review.required ? '是' : '否'}
            </Text>
          </Text>
          <Text>结论: {truncate(contract.conclusion, 220)}</Text>
          {contract.review.reasons.slice(0, 4).map(reason => (
            <Text key={reason} color="yellow">- {reason}</Text>
          ))}
          {contract.review.reasons.length > 4 && (
            <Text dimColor>...还有 {contract.review.reasons.length - 4} 条复核原因</Text>
          )}
        </>
      )}
      {roundsCompleted && totalRounds && (
        <Text dimColor>
          轮次: {roundsCompleted}/{totalRounds}
          {roundStopReason ? `，停止原因: ${roundStopReason}` : ''}
          {roundStopDetail ? `，${truncate(roundStopDetail, 120)}` : ''}
        </Text>
      )}
      {reportPath && (
        <Text>
          完整报告: <Text color="green">{reportPath}</Text>
          <Text dimColor>  （包含完整源码缺陷结论、证据、黑板、挑刺和各模型回答）</Text>
        </Text>
      )}
    </Box>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
