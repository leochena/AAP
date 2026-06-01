import { describe, expect, it } from 'vitest';
import { forecastUsPresidentialElection } from '../us-election';

describe('US presidential election forecasting model', () => {
  it('separates nomination and general election probability', () => {
    const forecast = forecastUsPresidentialElection({
      electionYear: 2028,
      candidates: [
        {
          id: 'a',
          name: 'Candidate A',
          party: 'X',
          nominationProbability: 0.8,
          nationalPolling: 3,
          stateSignals: [
            { state: 'PA', electoralVotes: 19, margin: 2 },
            { state: 'MI', electoralVotes: 15, margin: 1 },
            { state: 'GA', electoralVotes: 16, margin: -1 },
          ],
          fundraisingIndex: 0.5,
          endorsementIndex: 0.4,
        },
        {
          id: 'b',
          name: 'Candidate B',
          party: 'Y',
          nominationProbability: 0.35,
          nationalPolling: 4,
          declared: false,
        },
      ],
    });

    expect(forecast.rankings[0].candidateId).toBe('a');
    expect(forecast.rankings[0].electionProbability).toBeLessThanOrEqual(
      forecast.rankings[0].nominationProbability
    );
    expect(forecast.rankings.find(row => row.candidateId === 'b')?.uncertainty).toContain(
      'candidate not declared'
    );
  });
});
