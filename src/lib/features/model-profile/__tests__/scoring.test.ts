import { describe, expect, it } from 'vitest';
import { ModelCapabilityProfile, ProfileEvent } from '../types';
import { scoreModelProfile, suggestModelRoles } from '../scoring';

function event(overrides: Partial<ProfileEvent>): ProfileEvent {
  return {
    type: 'capability_probe',
    timestamp: 1,
    ...overrides,
  };
}

describe('model profile scoring', () => {
  it('scores measured capabilities without provider assumptions', () => {
    const profile: ModelCapabilityProfile = {
      modelId: 'local-model',
      events: [
        event({ capability: 'blind_answering', score: 0.8, sampleCount: 6 }),
        event({ type: 'evidence_audit', score: 0.9, sampleCount: 4 }),
        event({ type: 'calibration_result', brierScore: 0.16, logLoss: 0.35, sampleCount: 10 }),
      ],
    };

    const score = scoreModelProfile(profile);

    expect(score.modelId).toBe('local-model');
    expect(score.capabilityScores.blind_answering.score).toBe(0.8);
    expect(score.capabilityScores.evidence_grounding.score).toBe(0.9);
    expect(score.capabilityScores.calibration.score).toBeCloseTo((0.84 + Math.exp(-0.35)) / 2, 4);
    expect(score.overallScore).toBeGreaterThan(0.75);
    expect(score.voteWeight).toBeGreaterThan(0);
  });

  it('penalizes sycophancy signals and surfaces review reasons', () => {
    const profile: ModelCapabilityProfile = {
      modelId: 'agreeable',
      events: [
        event({ capability: 'blind_answering', score: 0.7, sampleCount: 5 }),
        event({ type: 'sycophancy_signal', severity: 'high', sampleCount: 2 }),
      ],
    };

    const score = scoreModelProfile(profile);

    expect(score.sycophancyRisk).toBe('high');
    expect(score.capabilityScores.sycophancy_resistance.score).toBe(0.2);
    expect(score.reviewReasons).toContain('high sycophancy risk');
  });

  it('keeps task-specific summaries separate from global capability evidence', () => {
    const profile: ModelCapabilityProfile = {
      modelId: 'task-aware',
      events: [
        event({ taskType: 'legal', capability: 'blind_answering', score: 0.3 }),
        event({ taskType: 'code', capability: 'blind_answering', score: 0.9 }),
        event({ capability: 'tool_use', score: 0.8 }),
      ],
    };

    const codeScore = scoreModelProfile(profile, { taskType: 'code' });

    expect(codeScore.capabilityScores.blind_answering.score).toBe(0.9);
    expect(codeScore.capabilityScores.tool_use.score).toBe(0.8);
    expect(codeScore.taskTypeScores.code.score).toBe(0.9);
    expect(codeScore.taskTypeScores.legal).toBeUndefined();
  });

  it('suggests roles from measured capability fit', () => {
    const profiles: ModelCapabilityProfile[] = [
      {
        modelId: 'evidence-model',
        events: [
          event({ capability: 'evidence_grounding', score: 0.95, sampleCount: 20 }),
          event({ capability: 'tool_use', score: 0.9, sampleCount: 20 }),
          event({ capability: 'calibration', score: 0.8, sampleCount: 20 }),
          event({ capability: 'sycophancy_resistance', score: 0.9, sampleCount: 20 }),
        ],
      },
      {
        modelId: 'challenge-model',
        events: [
          event({ capability: 'challenge_generation', score: 0.96, sampleCount: 20 }),
          event({ capability: 'conflict_adjudication', score: 0.88, sampleCount: 20 }),
          event({ capability: 'evidence_grounding', score: 0.75, sampleCount: 20 }),
          event({ capability: 'sycophancy_resistance', score: 0.9, sampleCount: 20 }),
        ],
      },
    ];

    const suggestions = suggestModelRoles(profiles, {
      roles: ['evidence_checker', 'challenger'],
      maxSuggestionsPerRole: 1,
    });

    expect(suggestions).toEqual([
      expect.objectContaining({ role: 'evidence_checker', modelId: 'evidence-model' }),
      expect.objectContaining({ role: 'challenger', modelId: 'challenge-model' }),
    ]);
  });
});
