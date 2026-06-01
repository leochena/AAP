import React from 'react';
import { Box, Text, useInput } from 'ink';
import { PreflightFailure } from '@/engine/preflight';

interface Props {
  failed: PreflightFailure[];
  okCount: number;
  onDropFailures: () => void;
  onAbort: () => void;
  onContinueAnyway: () => void;
}

export function PreflightWarning({
  failed,
  okCount,
  onDropFailures,
  onAbort,
  onContinueAnyway,
}: Props) {
  useInput(
    (input, key) => {
      if (key.escape || input === 'a' || input === 'A') {
        onAbort();
        return;
      }
      if (input === 'd' || input === 'D') {
        if (okCount > 0) onDropFailures();
        return;
      }
      if (key.return || input === 'c' || input === 'C') {
        onContinueAnyway();
        return;
      }
    },
    { isActive: true }
  );

  const canDrop = okCount > 0;

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="red" paddingX={1}>
      <Text bold color="red">
        ⚠ 预检失败 — {failed.length} 个模型不可用
      </Text>
      <Box marginTop={1} flexDirection="column">
        {failed.map(f => (
          <Box key={f.modelId} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color="red">✗</Text> <Text bold>{f.modelId}</Text>{' '}
              <Text dimColor>({f.upstreamModel})</Text>
            </Text>
            <Text dimColor>   {f.reason}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="green">[Enter / c]</Text> 保留全部模型继续（不可用模型会在面板中显示错误）
        </Text>
        <Text>
          <Text color={canDrop ? 'yellow' : 'gray'}>[d]</Text> 丢掉失败的、用剩余 {okCount} 个继续
          {!canDrop && <Text dimColor> (无可用模型，不可选)</Text>}
        </Text>
        <Text>
          <Text color="cyan">[a / Esc]</Text> 放弃本次运行
        </Text>
      </Box>
    </Box>
  );
}
