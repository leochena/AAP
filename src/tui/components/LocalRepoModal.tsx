import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  onSubmit: (path: string) => void;
  onCancel: () => void;
}

export function LocalRepoModal({ onSubmit, onCancel }: Props) {
  const [path, setPath] = useState('');

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="green" paddingX={1}>
      <Text bold>添加源码路径 (Enter 保存并开启工具循环、Esc 取消)</Text>
      <Box marginTop={1}>
        <Text>❯ </Text>
        <TextInput
          value={path}
          onChange={setPath}
          onSubmit={value => {
            const trimmed = value.trim().replace(/^["']|["']$/g, '');
            if (!trimmed) return;
            onSubmit(trimmed);
          }}
          placeholder="C:\\path\\to\\your\\repo"
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>只会授权这个 root 下的受控只读代码工具。</Text>
        <Text dimColor>硬排除 .git / dist / assets / node_modules / Python 环境 / 缓存 / 生成产物。</Text>
      </Box>
    </Box>
  );
}
