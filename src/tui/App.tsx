import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { EngineHub } from '@/engine/EngineHub';
import { useHub } from '@/tui/hooks/useHub';
import { RunListPanel } from '@/tui/components/RunListPanel';
import { RunDetailView } from '@/tui/components/RunDetailView';
import { InputModal } from '@/tui/components/InputModal';
import { DiscoverModal } from '@/tui/components/DiscoverModal';
import { PreflightWarning } from '@/tui/components/PreflightWarning';
import { UserOpinionModal } from '@/tui/components/UserOpinionModal';
import { ToolConfigStatus } from '@/tui/components/ToolConfigStatus';
import { ModelConfig } from '@/lib/types';
import { preflightCheck, PreflightResult } from '@/engine/preflight';

interface Props {
  hub: EngineHub;
  serverUrl?: string;
}

type Overlay =
  | { kind: 'none' }
  | { kind: 'input' }
  | { kind: 'discover' }
  | { kind: 'user-opinion'; question: string; modelIds: string[] }
  | {
      kind: 'preflighting';
      question: string;
      modelIds: string[];
      userOpinion?: { text: string; evidenceUrls?: string[] };
    }
  | {
      kind: 'preflight-warn';
      question: string;
      result: PreflightResult;
      userOpinion?: { text: string; evidenceUrls?: string[] };
    }
  | { kind: 'discover-error'; message: string };

export function App({ hub, serverUrl }: Props) {
  const { runs, order, config } = useHub(hub);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const { exit } = useApp();
  const { stdout } = useStdout();

  const cols = stdout?.columns ?? 100;
  const rows = stdout?.rows ?? 30;

  const selectedId = order[selectedIdx] ?? order[0];
  const selectedRun = selectedId ? runs[selectedId] : undefined;

  useEffect(() => {
    setSelectedIdx(i => Math.min(i, Math.max(0, order.length - 1)));
  }, [order.length]);

  useInput((input, key) => {
    if (overlay.kind !== 'none') return;

    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (input === 'n') {
      setOverlay({ kind: 'input' });
      return;
    }
    if (input === 'a') {
      setOverlay({ kind: 'discover' });
      return;
    }
    if (input === 'u' && selectedRun) {
      const modelIds = selectedRun.modelIds.length > 0
        ? selectedRun.modelIds
        : config.models.filter(m => m.enabled).map(m => m.id);
      setOverlay({ kind: 'user-opinion', question: selectedRun.question, modelIds });
      return;
    }
    if (key.upArrow) {
      setSelectedIdx(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIdx(i => Math.min(Math.max(0, order.length - 1), i + 1));
    }
  });

  const startRunSafely = (
    question: string,
    models: ModelConfig[],
    userOpinion?: { text: string; evidenceUrls?: string[] }
  ) => {
    try {
      hub.startRun({
        question,
        modelIds: models.map(m => m.id),
        source: 'tui-input',
        userOpinion,
      });
    } catch {
      /* errors will surface via run snapshot */
    }
  };

  const handleSubmitQuestion = async (
    question: string,
    modelIds: string[],
    userOpinion?: { text: string; evidenceUrls?: string[] }
  ) => {
    const selected = modelIds
      .map(id => config.models.find(m => m.id === id))
      .filter((m): m is ModelConfig => m !== undefined);
    setOverlay({ kind: 'preflighting', question, modelIds, userOpinion });
    const result = await preflightCheck(selected, { timeoutMs: 5000 });
    if (result.failed.length === 0) {
      setOverlay({ kind: 'none' });
      startRunSafely(question, result.ok, userOpinion);
      return;
    }
    setOverlay({ kind: 'preflight-warn', question, result, userOpinion });
  };

  const handleDiscoverSubmit = (newModels: ModelConfig[]) => {
    try {
      hub.addModelsAndSave(newModels);
      // Modal stays open in 'success' stage so user can chain more endpoints.
    } catch (err) {
      setOverlay({
        kind: 'discover-error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const totalRuns = order.length;
  const activeCount = Object.values(runs).filter(
    r => r.phase !== 'complete' && r.phase !== 'failed'
  ).length;

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          🥊 AI 对抗协议
        </Text>
        <Text dimColor>{'  '}</Text>
        {serverUrl && (
          <Text>
            <Text color="green">●</Text> Server: {serverUrl}
          </Text>
        )}
        <Text dimColor>
          {'  '}活跃: {activeCount} / 总: {totalRuns} · 已配置模型: {config.models.length}
        </Text>
      </Box>

      <ToolConfigStatus config={config} />

      <Box flexDirection="column" marginTop={1}>
        <Text bold>📋 运行列表</Text>
        <RunListPanel runs={runs} order={order} selectedRunId={selectedId} />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>🔬 详情</Text>
        <RunDetailView run={selectedRun} width={cols} rows={rows} />
      </Box>

      <Box marginTop={1} paddingX={1}>
        <Text dimColor>
          [↑↓] 切换 run · [n] 新问题 · [u] 追加用户意见 · [a] 添加模型 · [q] 退出
        </Text>
      </Box>

      {overlay.kind === 'input' && (
        <Box marginTop={1}>
          <InputModal
            models={config.models}
            onSubmit={handleSubmitQuestion}
            onCancel={() => setOverlay({ kind: 'none' })}
          />
        </Box>
      )}

      {overlay.kind === 'discover' && (
        <Box marginTop={1}>
          <DiscoverModal
            existingIds={config.models.map(m => m.id)}
            onSubmit={handleDiscoverSubmit}
            onCancel={() => setOverlay({ kind: 'none' })}
          />
        </Box>
      )}

      {overlay.kind === 'user-opinion' && (
        <Box marginTop={1}>
          <UserOpinionModal
            question={overlay.question}
            onSubmit={opinion => {
              const question = overlay.question;
              const modelIds = overlay.modelIds;
              setOverlay({ kind: 'none' });
              handleSubmitQuestion(question, modelIds, opinion);
            }}
            onCancel={() => setOverlay({ kind: 'none' })}
          />
        </Box>
      )}

      {overlay.kind === 'preflighting' && (
        <Box marginTop={1} borderStyle="double" borderColor="yellow" paddingX={1}>
          <Text>预检中… ({overlay.modelIds.length} 个模型)</Text>
        </Box>
      )}

      {overlay.kind === 'preflight-warn' && (
        <Box marginTop={1}>
          <PreflightWarning
            failed={overlay.result.failed}
            okCount={overlay.result.ok.length}
            onDropFailures={() => {
              const q = overlay.question;
              const models = overlay.result.ok;
              const opinion = overlay.userOpinion;
              setOverlay({ kind: 'none' });
              startRunSafely(q, models, opinion);
            }}
            onAbort={() => setOverlay({ kind: 'none' })}
            onContinueAnyway={() => {
              const q = overlay.question;
              const opinion = overlay.userOpinion;
              const all = [...overlay.result.ok, ...overlay.result.failed
                .map(f => config.models.find(m => m.id === f.modelId))
                .filter((m): m is ModelConfig => m !== undefined)];
              setOverlay({ kind: 'none' });
              startRunSafely(q, all, opinion);
            }}
          />
        </Box>
      )}

      {overlay.kind === 'discover-error' && (
        <Box marginTop={1} borderStyle="double" borderColor="red" paddingX={1} flexDirection="column">
          <Text bold color="red">添加失败</Text>
          <Text>{overlay.message}</Text>
          <Text dimColor>按 Enter 关闭</Text>
          <DismissOnEnter onDismiss={() => setOverlay({ kind: 'none' })} />
        </Box>
      )}
    </Box>
  );
}

function DismissOnEnter({ onDismiss }: { onDismiss: () => void }) {
  useInput((_input, key) => {
    if (key.return || key.escape) onDismiss();
  });
  return null;
}
