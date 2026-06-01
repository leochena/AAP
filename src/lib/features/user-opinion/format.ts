import { UserOpinionResult } from '@/lib/types';

export function formatUserOpinionResult(result?: UserOpinionResult): string {
  if (!result || result.claims.length === 0) return '';

  const lines: string[] = ['## 用户意见评审', '', result.summary, ''];
  for (const claim of result.claims) {
    const verdict = result.verdicts.find(v => v.claimId === claim.id);
    lines.push(`- ${claim.id} [${claim.type}]: ${claim.text}`);
    if (verdict) {
      lines.push(
        `  结论: ${formatStatus(verdict.status)}；支持 ${verdict.support} / 反驳 ${verdict.refute} / 部分 ${verdict.mixed} / 证据不足 ${verdict.insufficient}`
      );
      lines.push(`  原因: ${verdict.reason}`);
    }
    if (claim.evidenceUrls.length > 0) {
      lines.push(`  证据链接: ${claim.evidenceUrls.join(', ')}`);
    }
  }

  if (result.sycophancySignals.length > 0) {
    lines.push('', '### 反附和信号');
    for (const signal of result.sycophancySignals) {
      lines.push(`- [${signal.severity}] ${signal.modelId} / ${signal.claimId}: ${signal.reason}`);
    }
  }

  return lines.join('\n');
}

function formatStatus(status: string): string {
  switch (status) {
    case 'adopted':
      return '采纳';
    case 'rejected':
      return '反驳';
    case 'partial':
      return '部分采纳';
    case 'unresolved':
    default:
      return '证据不足';
  }
}
