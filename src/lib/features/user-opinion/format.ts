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
    const evidence = result.evidenceResults.filter(e => claim.evidenceUrls.includes(e.url));
    if (evidence.length > 0) {
      lines.push(
        `  证据状态: ${evidence
          .map(e => `${e.ok ? '已抓取' : e.status}/${shortUrl(e.url)}`)
          .join('；')}`
      );
    }
  }

  if (result.adoptionMatrix.length > 0) {
    lines.push('', '### 采纳矩阵');
    for (const row of result.adoptionMatrix) {
      const modelStances = Object.entries(row.byModel)
        .map(([modelId, stance]) => `${modelId}:${stance}`)
        .join(', ');
      lines.push(`- ${row.claimId}: ${formatStatus(row.status)} | ${modelStances || '无模型评审'}`);
    }
  }

  if (result.sycophancySignals.length > 0) {
    lines.push('', '### 反附和信号');
    for (const signal of result.sycophancySignals) {
      lines.push(`- [${signal.severity}] ${signal.modelId} / ${signal.claimId}: ${signal.reason}`);
    }
    const penalties = result.modelSycophancyScores
      .filter(score => score.signalCount > 0)
      .map(score => `${score.modelId}×${score.penaltyMultiplier.toFixed(2)}`)
      .join(', ');
    if (penalties) lines.push(`本轮投票权重惩罚: ${penalties}`);
  }

  return lines.join('\n');
}

function shortUrl(url: string): string {
  return url.length > 60 ? `${url.slice(0, 57)}...` : url;
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
