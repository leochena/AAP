import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  question: string;
  onSubmit: (opinion: { text: string; evidenceUrls?: string[] }) => void;
  onCancel: () => void;
}

export function UserOpinionModal({ question, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState('');

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="blue" paddingX={1}>
      <Text bold>追加用户意见/证据链接 (Enter 提交、Esc 取消)</Text>
      <Box marginTop={1}>
        <Text dimColor>问题: {question.length > 70 ? question.slice(0, 70) + '...' : question}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>❯ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={text => {
            const trimmed = text.trim();
            if (!trimmed) return;
            onSubmit({ text: trimmed });
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>这会启动一次新的盲答 run；用户意见只在盲答后作为待验证 claim 参与审查。</Text>
      </Box>
    </Box>
  );
}
