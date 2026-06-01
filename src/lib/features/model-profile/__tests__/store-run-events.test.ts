import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendProfileEvents,
  buildProfileEventsFromRun,
  loadModelProfileStore,
  modelProfileVoteMultiplier,
  scoreModelProfile,
} from '..';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

describe('model profile store and run events', () => {
  it('persists profile events and scores later vote multipliers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aap-profile-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'model-profiles.json');

    appendProfileEvents(filePath, [
      { modelId: 'm1', type: 'benchmark_result', capability: 'evidence_grounding', score: 0.95, sampleCount: 20, timestamp: 1 },
      { modelId: 'm1', type: 'benchmark_result', capability: 'calibration', score: 0.9, sampleCount: 20, timestamp: 2 },
      { modelId: 'm1', type: 'benchmark_result', capability: 'sycophancy_resistance', score: 0.9, sampleCount: 20, timestamp: 3 },
    ]);

    const profile = loadModelProfileStore(filePath).profiles.m1;
    const score = scoreModelProfile(profile);

    expect(profile.events).toHaveLength(3);
    expect(score.overallScore).toBeGreaterThan(0.85);
    expect(modelProfileVoteMultiplier(score)).toBeGreaterThan(1);
  });

  it('turns a completed run into lightweight profile events', () => {
    const events = buildProfileEventsFromRun({
      runId: 'run-1',
      taskType: 'adjudication:user-opinion',
      timestamp: 100,
      responses: [
        {
          modelId: 'm1',
          content: 'answer',
          tokensIn: 0,
          tokensOut: 0,
          durationMs: 0,
          toolCalls: [{ name: 'fetch_url', ok: true }],
        },
      ],
      challenges: [
        {
          id: 'c1',
          challengerId: 'm1',
          targetId: 'm2',
          type: 'factual-error',
          severity: 'high',
          targetSegment: 'x',
          reason: 'wrong',
          confidence: 0.8,
          status: 'pending',
          timestamp: 100,
        },
      ],
      userOpinion: {
        input: { text: 'claim' },
        claims: [{ id: 'uclaim-1', text: 'claim', type: 'fact', evidenceUrls: [] }],
        evidenceResults: [],
        assessments: [{ modelId: 'm1', claimId: 'uclaim-1', stance: 'support', confidence: 0.7, evidenceUsed: true }],
        verdicts: [],
        sycophancySignals: [],
        modelSycophancyScores: [],
        adoptionMatrix: [],
        graph: { nodes: [], edges: [] },
        summary: 'summary',
      },
      voting: {
        votes: [{ voterId: 'm1', choice: 'm1', confidence: 0.99, timestamp: 100 }],
        totals: { m1: 1 },
        winner: 'm1',
        consensusLevel: 1,
        isTie: false,
        isUnanimous: true,
        requiresReview: false,
      },
    });

    expect(events.map(event => event.capability ?? event.type)).toEqual(
      expect.arrayContaining(['blind_answering', 'tool_use', 'evidence_audit'])
    );
    expect(events.some(event => event.type === 'challenge_outcome' && event.challengeRole === 'challenger')).toBe(true);
    expect(events.find(event => event.source === 'voting-confidence')?.score).toBeUndefined();
  });
});
