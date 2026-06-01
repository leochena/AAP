import React from 'react';
import { Box, Text } from 'ink';
import { Challenge } from '@/lib/types';

interface Props {
  challenges: Challenge[];
}

const SEVERITY_COLOR: Record<Challenge['severity'], 'red' | 'yellow' | 'gray'> = {
  high: 'red',
  medium: 'yellow',
  low: 'gray',
};

export function ChallengeView({ challenges }: Props) {
  if (challenges.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">
        🔍 互相挑刺 ({challenges.length})
      </Text>
      {challenges.slice(0, 30).map(c => (
        <Box key={c.id} marginTop={1}>
          <Text>
            <Text color="cyan">{c.challengerId}</Text>
            <Text dimColor> → </Text>
            <Text color="blue">{c.targetId}</Text>
            <Text> [</Text>
            <Text color={SEVERITY_COLOR[c.severity]} bold>
              {c.severity}
            </Text>
            <Text>] </Text>
            <Text color="white">{c.type}</Text>
            <Text dimColor>: {c.reason}</Text>
          </Text>
        </Box>
      ))}
      {challenges.length > 30 && (
        <Box marginTop={1}>
          <Text dimColor>...还有 {challenges.length - 30} 条挑刺，请提高终端高度或查看 HTTP x_adversarial.challenges</Text>
        </Box>
      )}
    </Box>
  );
}
