import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Challenge,
  ProtocolOutputContract,
  RunRequest,
  RunResult,
  StructuredDeliberationResult,
  UserOpinionResult,
  VotingResult,
} from '@/lib/types';

export const RUN_REPORT_DIRNAME = 'runs';

export function writeRunReport(storageDir: string, result: RunResult, request: RunRequest): string {
  const reportDir = join(storageDir, RUN_REPORT_DIRNAME);
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `${safeFilePart(result.runId)}.md`);
  writeFileSync(reportPath, buildRunReportMarkdown(result, request), 'utf8');
  return reportPath;
}

export function buildRunReportMarkdown(result: RunResult, request: RunRequest): string {
  const lines: string[] = [
    `# AAP Run Report: ${safe(result.runId)}`,
    '',
    `- Generated at: ${new Date().toISOString()}`,
    `- Source: ${safe(request.source)}`,
    `- Duration: ${result.durationMs} ms`,
    `- Rounds: ${result.roundsCompleted ?? 'unknown'}`,
    `- Stop reason: ${result.roundStopReason ?? 'unknown'}`,
  ];
  if (result.roundStopDetail) lines.push(`- Stop detail: ${safe(result.roundStopDetail)}`);
  lines.push(
    '',
    '## Question',
    '',
    fenced(request.question),
    '',
    '## Protocol Verdict',
    '',
    formatFullProtocolOutput(result.protocolOutput),
    '',
    '## Voting',
    '',
    formatVoting(result.voting),
    '',
    '## User Opinion Review',
    '',
    formatUserOpinion(result.userOpinion),
    '',
    '## Structured Blackboard',
    '',
    formatStructuredDeliberationFull(result.structuredDeliberation),
    '',
    '## Challenges',
    '',
    formatChallenges(result.challenges),
    '',
    '## Model Final Outputs',
    '',
    ...result.responses.flatMap(response => {
      const toolCalls = response.toolCalls ?? [];
      const header = [`### ${safe(response.modelId)}`];
      if (response.error) header.push('', `Error: ${safe(response.error)}`);
      header.push(
        '',
        `- Duration: ${response.durationMs} ms`,
        `- Tokens: ${response.tokensIn} in / ${response.tokensOut} out`
      );
      if (response.withdrawn) {
        header.push(
          `- Withdrawn: yes`,
          `- Withdrawn reason: ${safe(response.withdrawnReason ?? 'not provided')}`,
          `- Defer to: ${safe(response.withdrawnDeferTo ?? 'not specified')}`
        );
      }
      if (toolCalls.length > 0) {
        header.push('', 'Tool calls:');
        for (const call of toolCalls) {
          header.push(
            `- ${safe(call.name)}: ${call.ok ? 'ok' : 'failed'}` +
              (call.error ? ` | ${safe(call.error)}` : '')
          );
        }
      }
      header.push('', fenced(response.content || '(empty response)'));
      return header;
    })
  );
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n')}\n`;
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bgitee_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITEE_TOKEN]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_GOOGLE_API_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(
      /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^"'\s`,;]+/gi,
      (_match, label: string) => `${label}=[REDACTED]`
    );
}

function formatFullProtocolOutput(contract?: ProtocolOutputContract): string {
  if (!contract) return '_No protocol output contract was produced._';
  const lines: string[] = [
    `Conclusion: ${safe(contract.conclusion)}`,
    `Confidence: ${(contract.confidence * 100).toFixed(1)}%`,
    `Review required: ${contract.review.required ? 'yes' : 'no'}`,
  ];
  if (contract.review.reasons.length > 0) {
    lines.push('', 'Review reasons:');
    for (const reason of contract.review.reasons) lines.push(`- ${safe(reason)}`);
  }
  if (contract.evidenceChain.length > 0) {
    lines.push('', 'Evidence chain:');
    for (const item of contract.evidenceChain) {
      const source = item.url ? `${item.source} (${item.url})` : item.source;
      lines.push(`- [${item.status}] ${safe(source)} | confidence ${(item.confidence * 100).toFixed(1)}%: ${safe(item.summary)}`);
    }
  }
  if (contract.conflictPoints.length > 0) {
    lines.push('', 'Conflict points:');
    for (const point of contract.conflictPoints) {
      lines.push(`- [${point.severity}] ${safe(point.source)}: ${safe(point.summary)}`);
    }
  }
  if (contract.userClaims.length > 0) {
    lines.push('', 'User-claim decisions:');
    for (const claim of contract.userClaims) {
      lines.push(`- ${safe(claim.claimId)} [${claim.decision}]: ${safe(claim.claimText)} | ${safe(claim.reason)}`);
    }
  }
  if (contract.sycophancyRisks.length > 0) {
    lines.push('', 'Sycophancy risks:');
    for (const risk of contract.sycophancyRisks) {
      const penalty = risk.penaltyMultiplier === undefined ? '' : ` | penalty x${risk.penaltyMultiplier.toFixed(2)}`;
      lines.push(`- [${risk.severity}] ${safe(risk.modelId)}${risk.claimId ? `/${safe(risk.claimId)}` : ''}${penalty}: ${safe(risk.reason)}`);
    }
  }
  return lines.join('\n');
}

function formatVoting(voting?: VotingResult): string {
  if (!voting) return '_Voting was disabled or skipped._';
  const lines: string[] = [
    `Winner: ${safe(voting.winner ?? 'none')}`,
    `Consensus: ${(voting.consensusLevel * 100).toFixed(1)}%`,
    `Tie: ${voting.isTie ? 'yes' : 'no'}`,
    `Unanimous: ${voting.isUnanimous ? 'yes' : 'no'}`,
    `Requires review: ${voting.requiresReview ? 'yes' : 'no'}`,
    '',
    'Totals:',
  ];
  for (const [modelId, score] of Object.entries(voting.totals)) {
    lines.push(`- ${safe(modelId)}: ${score.toFixed(3)}`);
  }
  if (voting.votes.length > 0) {
    lines.push('', 'Votes:');
    for (const vote of voting.votes) {
      lines.push(
        `- ${safe(vote.voterId)} -> ${safe(vote.choice)} | confidence ${(vote.confidence * 100).toFixed(1)}%` +
          (vote.reasoning ? ` | ${safe(vote.reasoning)}` : '')
      );
    }
  }
  return lines.join('\n');
}

function formatUserOpinion(result?: UserOpinionResult): string {
  if (!result) return '_No user opinion was supplied for this run._';
  const lines: string[] = [safe(result.summary), '', 'Input:', fenced(result.input.text)];
  if ((result.input.evidenceUrls ?? []).length > 0) {
    lines.push('Input evidence URLs:', ...result.input.evidenceUrls!.map(url => `- ${safe(url)}`));
  }
  if (result.claims.length > 0) {
    lines.push('', 'Claims and verdicts:');
    for (const claim of result.claims) {
      const verdict = result.verdicts.find(v => v.claimId === claim.id);
      lines.push(`- ${safe(claim.id)} [${claim.type}]: ${safe(claim.text)}`);
      if (verdict) {
        lines.push(
          `  - Verdict: ${verdict.status}; support ${verdict.support}, refute ${verdict.refute}, mixed ${verdict.mixed}, insufficient ${verdict.insufficient}; consensus ${(verdict.consensus * 100).toFixed(1)}%`,
          `  - Reason: ${safe(verdict.reason)}`
        );
      }
      for (const url of claim.evidenceUrls) lines.push(`  - Evidence URL: ${safe(url)}`);
    }
  }
  if (result.evidenceResults.length > 0) {
    lines.push('', 'Evidence fetch results:');
    for (const evidence of result.evidenceResults) {
      lines.push(
        `- ${safe(evidence.url)} | ${evidence.status} | ok=${evidence.ok}` +
          (evidence.statusCode ? ` | status=${evidence.statusCode}` : '') +
          (evidence.title ? ` | title=${safe(evidence.title)}` : '')
      );
      if (evidence.preview) lines.push(`  - Preview: ${safe(evidence.preview)}`);
      if (evidence.error) lines.push(`  - Error: ${safe(evidence.error)}`);
    }
  }
  if (result.assessments.length > 0) {
    lines.push('', 'Model assessments:');
    for (const assessment of result.assessments) {
      lines.push(
        `- ${safe(assessment.modelId)} on ${safe(assessment.claimId)}: ${assessment.stance}; confidence ${(assessment.confidence * 100).toFixed(1)}%; evidenceUsed=${assessment.evidenceUsed}` +
          (assessment.reasoning ? ` | ${safe(assessment.reasoning)}` : '')
      );
    }
  }
  if (result.adoptionMatrix.length > 0) {
    lines.push('', 'Adoption matrix:');
    for (const row of result.adoptionMatrix) {
      const stances = Object.entries(row.byModel).map(([id, stance]) => `${id}:${stance}`).join(', ') || 'no model assessments';
      const evidence = row.evidenceStatuses.map(item => `${item.status}/${item.ok ? 'ok' : 'not-ok'}:${item.url}`).join('; ') || 'no evidence';
      lines.push(`- ${safe(row.claimId)} [${row.status}]: ${safe(row.claimText)} | ${safe(stances)} | ${safe(evidence)}`);
      if (row.sycophancyRiskModels.length > 0) {
        lines.push(`  - Sycophancy risk models: ${row.sycophancyRiskModels.map(safe).join(', ')}`);
      }
    }
  }
  if (result.sycophancySignals.length > 0) {
    lines.push('', 'Anti-sycophancy signals:');
    for (const signal of result.sycophancySignals) {
      lines.push(`- [${signal.severity}] ${safe(signal.modelId)}/${safe(signal.claimId)}: ${safe(signal.reason)}`);
    }
  }
  if (result.modelSycophancyScores.length > 0) {
    lines.push('', 'Sycophancy vote penalties:');
    for (const score of result.modelSycophancyScores) {
      lines.push(`- ${safe(score.modelId)}: signals=${score.signalCount}, max=${score.maxSeverity}, multiplier=${score.penaltyMultiplier.toFixed(2)} | ${safe(score.reason)}`);
    }
  }
  lines.push('', `Debate graph: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges.`);
  return lines.join('\n');
}

function formatStructuredDeliberationFull(result?: StructuredDeliberationResult): string {
  if (!result) return '_No structured blackboard was produced._';
  const lines: string[] = [
    safe(result.summary),
    '',
    `Current round: ${result.currentRound}`,
    `Claims: ${result.claims.length}`,
    `Evidence refs: ${result.evidenceRefs.length}`,
    `Challenge refs: ${result.challengeRefs.length}`,
    `Consensus risks: ${result.consensusRisks.length}`,
    `Identity drift signals: ${result.identityDriftSignals.length}`,
    `Minority protection signals: ${result.minorityProtection.length}`,
    `Revision directives: ${result.revisionDirectives.length}`,
  ];
  if (result.rounds.length > 0) {
    lines.push('', 'Round summaries:');
    for (const round of result.rounds) lines.push(`- r${round.round}: ${safe(round.summary)}`);
  }
  if (result.claims.length > 0) {
    lines.push('', 'Claims:');
    for (const claim of result.claims) {
      lines.push(`- ${safe(claim.id)} | r${claim.round} | ${safe(claim.modelId)} | confidence ${(claim.confidence * 100).toFixed(1)}% | uncertainty=${claim.uncertainty}: ${safe(claim.text)}`);
      if (claim.evidenceRefs.length > 0) lines.push(`  - Evidence refs: ${claim.evidenceRefs.map(safe).join(', ')}`);
    }
  }
  if (result.evidenceRefs.length > 0) {
    lines.push('', 'Evidence refs:');
    for (const ref of result.evidenceRefs) {
      lines.push(`- ${safe(ref.id)} | first r${ref.firstSeenRound} | ${safe(ref.host)} | ${safe(ref.url)} | claims=${ref.claimIds.map(safe).join(', ')}`);
    }
  }
  if (result.consensusClusters.length > 0) {
    lines.push('', 'Consensus clusters:');
    for (const cluster of result.consensusClusters) {
      lines.push(`- ${safe(cluster.id)} | risk=${cluster.risk} | models=${cluster.modelIds.map(safe).join(', ')} | independentEvidence=${cluster.independentEvidenceCount} | claims=${cluster.claimIds.map(safe).join(', ')}`);
    }
  }
  if (result.challengeRefs.length > 0) {
    lines.push('', 'Registered challenge refs:');
    for (const challenge of result.challengeRefs) {
      lines.push(`- ${safe(challenge.id)} | r${challenge.round} | ${safe(challenge.challengerId)} -> ${safe(challenge.targetId)} | [${challenge.severity}/${challenge.type}] confidence ${(challenge.confidence * 100).toFixed(1)}%: ${safe(challenge.reason)}`);
      if (challenge.targetSegment) lines.push(`  - Target: ${safe(challenge.targetSegment)}`);
    }
  }
  if (result.identityDriftSignals.length > 0) {
    lines.push('', 'Identity drift signals:');
    for (const signal of result.identityDriftSignals) {
      lines.push(`- ${safe(signal.id)} | r${signal.round} | [${signal.severity}] ${safe(signal.modelId)} claimed ${safe(signal.claimedIdentity)} while runtime=${safe(signal.runtimeIdentity)}: ${safe(signal.reason)}`);
    }
  }
  if (result.consensusRisks.length > 0) {
    lines.push('', 'Consensus risks:');
    for (const risk of result.consensusRisks) {
      lines.push(`- ${safe(risk.id)} | r${risk.round} | [${risk.severity}] ${safe(risk.clusterId)} | independentEvidence=${risk.independentEvidenceCount}: ${safe(risk.reason)}`);
    }
  }
  if (result.minorityProtection.length > 0) {
    lines.push('', 'Minority protection signals:');
    for (const signal of result.minorityProtection) {
      lines.push(`- ${safe(signal.id)} | r${signal.round} | [${signal.severity}] ${safe(signal.modelId)}/${safe(signal.claimId)} against ${safe(signal.againstClusterId)}: ${safe(signal.reason)}`);
    }
  }
  if (result.revisionDirectives.length > 0) {
    lines.push('', 'Revision directives:');
    for (const directive of result.revisionDirectives) {
      lines.push(`- ${safe(directive.id)} | r${directive.round} | ${directive.required ? 'required' : 'optional'} | ${safe(directive.modelId)} | ${directive.source}: ${safe(directive.reason)}`);
      if (directive.targetClaimIds.length > 0) lines.push(`  - Target claims: ${directive.targetClaimIds.map(safe).join(', ')}`);
    }
  }
  if (result.events.length > 0) {
    lines.push('', 'Controller events:');
    for (const event of result.events) {
      lines.push(`- ${safe(event.id)} | r${event.round} | ${safe(event.actorId)} | ${event.action}${event.targetId ? ` -> ${safe(event.targetId)}` : ''}: ${safe(event.summary)}`);
    }
  }
  if (result.reviewReasons.length > 0) {
    lines.push('', 'Blackboard review reasons:');
    for (const reason of result.reviewReasons) lines.push(`- ${safe(reason)}`);
  }
  return lines.join('\n');
}

function formatChallenges(challenges: Challenge[]): string {
  if (challenges.length === 0) return '_No peer challenges were recorded._';
  return challenges.map(challenge => {
    const lines = [
      `- ${safe(challenge.id)} | ${safe(challenge.challengerId)} -> ${safe(challenge.targetId)} | [${challenge.severity}/${challenge.type}] confidence ${(challenge.confidence * 100).toFixed(1)}% | status=${challenge.status}`,
      `  - Target segment: ${safe(challenge.targetSegment)}`,
      `  - Reason: ${safe(challenge.reason)}`,
    ];
    return lines.join('\n');
  }).join('\n');
}

function fenced(value: string): string {
  const redacted = safe(value);
  const longest = Math.max(2, ...[...redacted.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${redacted}\n${fence}`;
}

function safe(value: unknown): string {
  return redactSecrets(String(value ?? ''));
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
