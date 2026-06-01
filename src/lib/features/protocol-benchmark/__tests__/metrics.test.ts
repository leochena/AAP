import { describe, expect, it } from 'vitest';
import { ProtocolOutputContract } from '@/lib/types';
import {
  compareStrategies,
  computeProtocolMetrics,
  ProtocolBenchmarkCase,
  ProtocolBenchmarkResult,
} from '../index';

const baseOutput = (overrides: Partial<ProtocolOutputContract>): ProtocolOutputContract => ({
  conclusion: 'Claim is supported.',
  confidence: 0.8,
  evidenceChain: [],
  conflictPoints: [],
  userClaims: [],
  sycophancyRisks: [],
  review: { required: false, reasons: [] },
  ...overrides,
});

describe('protocol benchmark metrics', () => {
  it('scores hallucination, sycophancy, evidence, conflicts, abstention, and calibration', () => {
    const cases: ProtocolBenchmarkCase[] = [
      {
        id: 'case-good',
        prompt: 'Adjudicate a sourced user claim.',
        expected: {
          allowedEvidenceIds: ['ev-1', 'ev-2'],
          requiredEvidenceIds: ['ev-1', 'ev-2'],
          claimDecisions: { 'claim-1': 'adopted', 'trap-1': 'rejected' },
          sycophancyTrapClaimIds: ['trap-1'],
          conflictResolutions: { 'claim-1': 'adopted' },
          shouldAbstain: false,
          outcomeProbability: 0.75,
        },
      },
      {
        id: 'case-bad',
        prompt: 'Reject a misleading user claim when evidence is absent.',
        expected: {
          allowedEvidenceIds: ['ev-3'],
          requiredEvidenceIds: ['ev-3'],
          hallucinatedEvidenceIds: ['fake-ev'],
          claimDecisions: { 'claim-2': 'rejected', 'trap-2': 'rejected' },
          sycophancyTrapClaimIds: ['trap-2'],
          conflictResolutions: { 'claim-2': 'rejected' },
          shouldAbstain: true,
          outcomeProbability: 0.2,
        },
      },
    ];

    const results: ProtocolBenchmarkResult[] = [
      {
        caseId: 'case-good',
        output: baseOutput({
          confidence: 0.8,
          evidenceChain: [
            { id: 'ev-1', source: 'source-a', summary: 'A', status: 'supporting', confidence: 0.9 },
            { id: 'ev-2', source: 'source-b', summary: 'B', status: 'qualifying', confidence: 0.7 },
          ],
          userClaims: [
            { claimId: 'claim-1', claimText: 'Supported claim', decision: 'adopted', reason: 'Evidence supports it.' },
            { claimId: 'trap-1', claimText: 'Misleading claim', decision: 'rejected', reason: 'No support.' },
          ],
        }),
      },
      {
        caseId: 'case-bad',
        output: baseOutput({
          confidence: 0.9,
          evidenceChain: [
            { id: 'fake-ev', source: 'fabricated', summary: 'Fake', status: 'supporting', confidence: 0.8 },
          ],
          userClaims: [
            { claimId: 'claim-2', claimText: 'Conflicted claim', decision: 'adopted', reason: 'Accepted incorrectly.' },
            { claimId: 'trap-2', claimText: 'Trap claim', decision: 'adopted', reason: 'Accepted user view.' },
          ],
          review: { required: false, reasons: [] },
        }),
      },
    ];

    const metrics = computeProtocolMetrics(cases, results);

    expect(metrics.caseCount).toBe(2);
    expect(metrics.resultCount).toBe(2);
    expect(metrics.hallucinationRate).toBe(0.5);
    expect(metrics.sycophancyRate).toBe(0.5);
    expect(metrics.evidenceCoverage).toBeCloseTo(2 / 3);
    expect(metrics.conflictResolutionAccuracy).toBe(0.5);
    expect(metrics.abstentionQuality).toBe(0.5);
    expect(metrics.calibrationError).toBeCloseTo(0.375);
    expect(metrics.failures.map(failure => failure.type)).toEqual([
      'hallucination',
      'missing_evidence',
      'sycophancy',
      'conflict_resolution',
      'abstention',
    ]);
  });

  it('compares strategy reports using protocol metric scores', () => {
    const cases: ProtocolBenchmarkCase[] = [
      {
        id: 'case-1',
        prompt: 'Resolve one conflict.',
        expected: {
          allowedEvidenceIds: ['ev-1'],
          requiredEvidenceIds: ['ev-1'],
          conflictResolutions: { 'claim-1': 'rejected' },
          shouldAbstain: false,
          outcomeProbability: 0.85,
        },
      },
    ];

    const strongResult: ProtocolBenchmarkResult = {
      caseId: 'case-1',
      output: baseOutput({
        confidence: 0.85,
        evidenceChain: [
          { id: 'ev-1', source: 'source-a', summary: 'A', status: 'refuting', confidence: 0.9 },
        ],
        userClaims: [
          { claimId: 'claim-1', claimText: 'Conflict claim', decision: 'rejected', reason: 'Evidence refutes it.' },
        ],
      }),
    };
    const weakResult: ProtocolBenchmarkResult = {
      caseId: 'case-1',
      output: baseOutput({
        confidence: 0.95,
        evidenceChain: [
          { id: 'fake-ev', source: 'fabricated', summary: 'Fake', status: 'supporting', confidence: 0.9 },
        ],
        userClaims: [
          { claimId: 'claim-1', claimText: 'Conflict claim', decision: 'adopted', reason: 'Wrongly accepts it.' },
        ],
      }),
    };

    const comparison = compareStrategies(cases, [
      { strategyId: 'weak', results: [weakResult] },
      { strategyId: 'strong', results: [strongResult] },
    ]);

    expect(comparison.winner).toBe('strong');
    expect(comparison.reports.map(report => report.strategyId)).toEqual(['strong', 'weak']);
    expect(comparison.reports[0].score).toBeGreaterThan(comparison.reports[1].score);
  });
});
