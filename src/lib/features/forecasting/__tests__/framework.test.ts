import { describe, expect, it } from 'vitest';
import { brierScore, logLoss, runForecastModel } from '../framework';

describe('forecasting framework', () => {
  it('normalizes probabilities and caps qualitative preference impact', () => {
    const result = runForecastModel({
      id: 'demo',
      title: 'Demo forecast',
      qualitativeSignalCap: 0.1,
      candidates: [
        {
          id: 'a',
          name: 'Structured leader',
          baseRate: 0.7,
          signals: [{ name: 'poll lead', kind: 'poll', weight: 1, impact: 0.4, reliability: 0.9 }],
        },
        {
          id: 'b',
          name: 'LLM favorite',
          baseRate: 0.3,
          signals: [{ name: 'textual preference', kind: 'qualitative', weight: 99, impact: 99, reliability: 1 }],
        },
      ],
    });

    expect(result.probabilitySum).toBeCloseTo(1, 5);
    expect(result.candidates[0].candidateId).toBe('a');
    expect(result.notes.join('\n')).toContain('Qualitative');
  });

  it('calculates calibration losses', () => {
    expect(brierScore(0.8, true)).toBeCloseTo(0.04);
    expect(logLoss(0.8, true)).toBeCloseTo(0.2231, 3);
  });
});
