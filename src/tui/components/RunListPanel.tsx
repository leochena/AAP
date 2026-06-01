import React from 'react';
import { Box, Text } from 'ink';
import { UIRunState } from '@/tui/hooks/useHub';

interface Props {
  runs: Record<string, UIRunState>;
  order: string[];
  selectedRunId?: string;
}

const SOURCE_COLOR: Record<UIRunState['source'], 'cyan' | 'magenta' | 'yellow'> = {
  'tui-input': 'cyan',
  'http-openai': 'magenta',
  'http-anthropic': 'yellow',
};

const PHASE_LABEL: Record<UIRunState['phase'], string> = {
  pending: '⋯',
  generating: '生成中',
  deliberation: '黑板',
  'auto-challenge': '挑刺中',
  'user-opinion': '用户意见',
  voting: '投票中',
  complete: '✓ 完成',
  failed: '✗ 失败',
};

export function RunListPanel({ runs, order, selectedRunId }: Props) {
  if (order.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>(暂无运行记录 - 按 [n] 输入新问题)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {order.slice(0, 5).map(id => {
        const r = runs[id];
        if (!r) return null;
        const isSelected = id === selectedRunId;
        const elapsed =
          r.finishedAt !== undefined
            ? `${((r.finishedAt - r.startedAt) / 1000).toFixed(1)}s`
            : `${((Date.now() - r.startedAt) / 1000).toFixed(0)}s`;

        return (
          <Box key={id}>
            <Text color={isSelected ? 'green' : undefined}>
              {isSelected ? '▶ ' : '  '}
            </Text>
            <Text color={SOURCE_COLOR[r.source]} bold>
              [{r.source}]
            </Text>
            <Text> </Text>
            <Text>{PHASE_LABEL[r.phase]}</Text>
            <Text dimColor> {elapsed}</Text>
            <Text> </Text>
            <Text>
              {r.question.length > 40 ? r.question.slice(0, 40) + '...' : r.question}
            </Text>
          </Box>
        );
      })}
      {order.length > 5 && (
        <Text dimColor>...还有 {order.length - 5} 条历史</Text>
      )}
    </Box>
  );
}
