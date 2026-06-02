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
      {result.rounds.slice(-4).map(round => (
        <Text key={round.round} color="magenta">
          r{round.round}: claims {round.claimIds.length}, challenges {round.challengeIds.length}, directives {round.revisionDirectiveIds.length}
        </Text>
      ))}
      {result.challengeRefs.slice(-4).map(challenge => (
        <Text key={challenge.id} color={challenge.severity === 'high' ? 'red' : challenge.severity === 'medium' ? 'yellow' : 'gray'}>
          挑刺入黑板 r{challenge.round} {challenge.challengerId}{'->'}{challenge.targetId} [{challenge.severity}]
        </Text>
      ))}
      {result.identityDriftSignals.slice(0, 4).map(signal => (
        <Text key={signal.id} color="red">
          身份漂移 r{signal.round} {signal.modelId}: claimed {signal.claimedIdentity}
        </Text>
      ))}
      {result.consensusRisks.slice(0, 4).map(signal => (
        <Text key={signal.id} color={signal.severity === 'high' ? 'red' : 'yellow'}>
          共识风险 r{signal.round} {signal.clusterId}: {signal.independentEvidenceCount} independent evidence source(s)
        </Text>
      ))}
      {result.minorityProtection.slice(0, 4).map(signal => (
        <Text key={signal.id} color="cyan">
          少数派保护 r{signal.round} {signal.modelId}/{signal.claimId}
        </Text>
      ))}
      {result.revisionDirectives.length > 0 && (
        <Text dimColor>
          修正指令: {result.revisionDirectives.length}，最新来源: {result.revisionDirectives.slice(-3).map(d => `${d.modelId}/${d.source}`).join(', ')}
        </Text>
      )}
    </Box>
  );
}
