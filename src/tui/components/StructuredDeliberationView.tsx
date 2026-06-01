import React from 'react';
import { Box, Text } from 'ink';
import { StructuredDeliberationResult } from '@/lib/types';

interface Props {
  result?: StructuredDeliberationResult;
}

export function StructuredDeliberationView({ result }: Props) {
  if (!result) return null;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">结构化黑板</Text>
      <Text dimColor>{result.summary}</Text>
      {result.identityDriftSignals.slice(0, 4).map(signal => (
        <Text key={signal.id} color="red">
          身份漂移 {signal.modelId}: claimed {signal.claimedIdentity}
        </Text>
      ))}
      {result.consensusRisks.slice(0, 4).map(signal => (
        <Text key={signal.id} color={signal.severity === 'high' ? 'red' : 'yellow'}>
          共识风险 {signal.clusterId}: {signal.independentEvidenceCount} independent evidence source(s)
        </Text>
      ))}
      {result.minorityProtection.slice(0, 4).map(signal => (
        <Text key={signal.id} color="cyan">
          少数派保护 {signal.modelId}/{signal.claimId}
        </Text>
      ))}
      {result.revisionDirectives.length > 0 && (
        <Text dimColor>修正指令: {result.revisionDirectives.length}</Text>
      )}
    </Box>
  );
}
