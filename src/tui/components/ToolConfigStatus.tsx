import React from 'react';
import { Box, Text } from 'ink';
import type { AppConfig } from '@/lib/types';

interface Props {
  config: AppConfig;
}

export function ToolConfigStatus({ config }: Props) {
  const tools = config.adversarial.tools;
  const localRepo = tools.localRepo;
  const rootCount = localRepo?.roots.length ?? 0;
  const repoReady = tools.enabled && localRepo?.enabled === true && rootCount > 0;

  if (repoReady) {
    return (
      <Box paddingX={1}>
        <Text color="green">tools on</Text>
        <Text dimColor> · </Text>
        <Text color="green">local-repo ready</Text>
        <Text dimColor>
          {' '}({rootCount} root{rootCount === 1 ? '' : 's'}, excludes .git/dist/assets/node_modules/python envs)
        </Text>
      </Box>
    );
  }

  const hints: string[] = [];
  if (!tools.enabled) hints.push('aap tools enable');
  if (!localRepo?.enabled || rootCount === 0) hints.push('aap tools repo add <path>');
  const tuiHint = !localRepo?.enabled || rootCount === 0 ? 'press [r]' : undefined;

  return (
    <Box paddingX={1}>
      <Text color={tools.enabled ? 'green' : 'yellow'}>
        tools {tools.enabled ? 'on' : 'off'}
      </Text>
      <Text dimColor> · </Text>
      <Text color={localRepo?.enabled && rootCount > 0 ? 'green' : 'yellow'}>
        local-repo {localRepo?.enabled && rootCount > 0 ? `${rootCount} root(s)` : 'not configured'}
      </Text>
      {hints.length > 0 && (
        <Text dimColor>
          {' '}· enable code audit: {[tuiHint, hints.join(' && ')].filter(Boolean).join(' or ')}
        </Text>
      )}
    </Box>
  );
}
