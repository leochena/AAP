import React from 'react';
import { Box, Text } from 'ink';
import { RunPhase } from '@/lib/types';

interface Props {
  phase: RunPhase;
}

const PHASES: { key: RunPhase; label: string }[] = [
  { key: 'generating', label: '生成' },
  { key: 'deliberation', label: '黑板' },
  { key: 'auto-challenge', label: '挑刺' },
  { key: 'user-opinion', label: '用户意见' },
  { key: 'voting', label: '投票' },
  { key: 'complete', label: '完成' },
];

export function PhaseIndicator({ phase }: Props) {
  const currentIdx = PHASES.findIndex(p => p.key === phase);

  if (phase === 'failed') {
    return (
      <Box>
        <Text color="red" bold>
          ✗ FAILED
        </Text>
      </Box>
    );
  }

  return (
    <Box>
      {PHASES.map((p, i) => {
        const done = i < currentIdx || phase === 'complete';
        const active = i === currentIdx && phase !== 'complete';
        const pending = i > currentIdx;

        let icon = '○';
        let color: 'green' | 'yellow' | 'gray' = 'gray';
        if (done) {
          icon = '✓';
          color = 'green';
        } else if (active) {
          icon = '▶';
          color = 'yellow';
        }

        return (
          <Box key={p.key} marginRight={2}>
            <Text color={color} bold={active}>
              {icon} {p.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
