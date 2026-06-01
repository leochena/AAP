import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { ModelConfig } from '@/lib/types';

interface Props {
  models: ModelConfig[];
  onSubmit: (
    question: string,
    modelIds: string[],
    userOpinion?: { text: string; evidenceUrls?: string[] }
  ) => void;
  onCancel: () => void;
}

type Stage = 'select-models' | 'enter-question';

export function InputModal({ models, onSubmit, onCancel }: Props) {
  const enabled = models.filter(m => m.enabled);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(enabled.map(m => m.id))
  );
  const [stage, setStage] = useState<Stage>('select-models');
  const [question, setQuestion] = useState('');
  const [cursor, setCursor] = useState(0);

  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }

      if (stage === 'select-models') {
        if (key.upArrow) {
          setCursor(c => Math.max(0, c - 1));
        } else if (key.downArrow) {
          setCursor(c => Math.min(enabled.length - 1, c + 1));
        } else if (input === ' ') {
          const id = enabled[cursor]?.id;
          if (id) {
            setSelected(prev => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }
        } else if (key.return) {
          if (selected.size === 0) return;
          setStage('enter-question');
        }
      }
      // enter-question 阶段：return 由 TextInput 处理
    },
    { isActive: true }
  );

  if (stage === 'select-models') {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="blue" paddingX={1}>
        <Text bold>选择参与对抗的模型 (空格切换、Enter 确认、Esc 取消)</Text>
        <Box marginTop={1} flexDirection="column">
          {enabled.length === 0 && (
            <Text color="red">没有 enabled 的模型，请先 aap config add</Text>
          )}
          {enabled.map((m, i) => {
            const isCursor = i === cursor;
            const isSelected = selected.has(m.id);
            return (
              <Text key={m.id}>
                {isCursor ? '▶ ' : '  '}
                <Text color={isSelected ? 'green' : 'gray'}>{isSelected ? '[x]' : '[ ]'}</Text>{' '}
                <Text bold={isCursor}>{m.id}</Text>
                <Text dimColor>
                  {' '}
                  ({m.protocol} / {m.model})
                </Text>
              </Text>
            );
          })}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            已选 {selected.size} / {enabled.length}
          </Text>
        </Box>
      </Box>
    );
  }

  if (stage === 'enter-question') {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="blue" paddingX={1}>
        <Text bold>输入问题 (Enter 开始盲答、Esc 取消)</Text>
        <Box marginTop={1}>
          <Text>❯ </Text>
          <TextInput
            value={question}
            onChange={setQuestion}
            onSubmit={value => {
              const trimmed = value.trim();
              if (!trimmed) return;
              onSubmit(trimmed, [...selected]);
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>参与模型: {[...selected].join(', ')}</Text>
        </Box>
        <Box>
          <Text dimColor>盲答完成后可按 [u] 给当前问题追加用户意见/证据链接。</Text>
        </Box>
      </Box>
    );
  }
}
