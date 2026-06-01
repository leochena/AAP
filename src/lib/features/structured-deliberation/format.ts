import { StructuredDeliberationResult } from '@/lib/types';

export function formatStructuredDeliberation(result?: StructuredDeliberationResult): string {
  if (!result) return '';
  const lines = [
    '## 结构化黑板',
    '',
    result.summary,
  ];
  if (result.identityDriftSignals.length > 0) {
    lines.push('', '### 身份漂移');
    for (const signal of result.identityDriftSignals.slice(0, 6)) {
      lines.push(`- [${signal.severity}] ${signal.modelId}: claimed ${signal.claimedIdentity}; runtime=${signal.runtimeIdentity}`);
    }
  }
  if (result.consensusRisks.length > 0) {
    lines.push('', '### 共识风险');
    for (const risk of result.consensusRisks.slice(0, 6)) {
      lines.push(`- [${risk.severity}] ${risk.clusterId}: ${risk.reason}`);
    }
  }
  if (result.minorityProtection.length > 0) {
    lines.push('', '### 少数派保护');
    for (const signal of result.minorityProtection.slice(0, 6)) {
      lines.push(`- [${signal.severity}] ${signal.modelId}/${signal.claimId}: ${signal.reason}`);
    }
  }
  if (result.revisionDirectives.length > 0) {
    lines.push('', '### 修正指令');
    for (const directive of result.revisionDirectives.slice(0, 8)) {
      lines.push(`- ${directive.required ? 'required' : 'optional'} ${directive.modelId}: ${directive.reason}`);
    }
  }
  return lines.join('\n');
}
