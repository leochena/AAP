import { describe, expect, it } from 'vitest';
import { forecastWorldCupChampion } from '../world-cup';

describe('world cup forecasting model', () => {
  it('produces stable probability rankings from structured team inputs', () => {
    const forecast = forecastWorldCupChampion({
      simulations: 2000,
      seed: 42,
      teams: [
        { id: 'bra', name: 'Brazil', rating: 2100, recentForm: 0.4, squadHealth: 0.2 },
        { id: 'fra', name: 'France', rating: 2050, recentForm: 0.2, squadHealth: 0.1 },
        { id: 'usa', name: 'United States', rating: 1800, recentForm: 0.1, squadHealth: 0.1 },
      ],
    });

    expect(forecast.rankings[0].teamId).toBe('bra');
    expect(forecast.rankings.reduce((sum, row) => sum + row.probability, 0)).toBeCloseTo(1, 2);
    expect(forecast.rankings[0].drivers.join(' ')).toContain('rating');
  });
});
