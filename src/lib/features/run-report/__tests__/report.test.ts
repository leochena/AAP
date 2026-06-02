import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeRunReport } from '../report';
import type { RunRequest, RunResult } from '@/lib/types';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

describe('run report', () => {
  it('persists the full final run details and redacts secret-shaped values', () => {
    const storageDir = mkdtempSync(join(tmpdir(), 'aap-run-report-'));
    tempDirs.push(storageDir);
    const fakeSecret = ['sk', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
    const request: RunRequest = {
      question: `Audit this repository and do not leak ${fakeSecret}.`,
      modelIds: ['m1', 'm2'],
      source: 'tui-input',
    };
    const result: RunResult = {
      runId: 'run-report-test',
      responses: [
        {
          modelId: 'm1',
          content: `Final code defect conclusion: the missing validation appears in src/app.ts:42. ${fakeSecret}`,
          tokensIn: 11,
          tokensOut: 17,
          durationMs: 123,
          toolCalls: [{ name: 'repo_read_file', ok: true }],
        },
        {
          modelId: 'm2',
          content: 'Second model challenges the severity but agrees the file reference is real.',
          tokensIn: 7,
          tokensOut: 13,
          durationMs: 90,
        },
      ],
      challenges: [
        {
          id: 'c1',
          challengerId: 'm2',
          targetId: 'm1',
          type: 'logical-flaw',
          severity: 'medium',
          targetSegment: 'validation appears',
          reason: 'Severity needs proof from a failing test.',
          confidence: 0.72,
          status: 'pending',
          timestamp: 1,
        },
      ],
      metrics: {},
      durationMs: 500,
      roundsCompleted: 2,
      roundStopReason: 'converged',
      protocolOutput: {
        conclusion: 'The code defect is plausible but needs a failing test before release action.',
        confidence: 0.64,
        evidenceChain: [],
        conflictPoints: [
          { id: 'conflict-1', source: 'm2->m1', summary: 'Severity is under-evidenced.', severity: 'medium' },
        ],
        userClaims: [],
        sycophancyRisks: [],
        review: { required: true, reasons: ['Needs test evidence'] },
      },
    };

    const reportPath = writeRunReport(storageDir, result, request);
    const report = readFileSync(reportPath, 'utf8');

    expect(reportPath).toContain(join(storageDir, 'runs', 'run-report-test.md'));
    expect(report).toContain('Final code defect conclusion');
    expect(report).toContain('src/app.ts:42');
    expect(report).toContain('Severity needs proof from a failing test.');
    expect(report).toContain('repo_read_file: ok');
    expect(report).toContain('[REDACTED_API_KEY]');
    expect(report).not.toContain(fakeSecret);
  });
});
