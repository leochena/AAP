export interface WorldCupTeamInput {
  id: string;
  name: string;
  rating: number;
  recentForm?: number;
  squadHealth?: number;
  pathDifficulty?: number;
  marketImplied?: number;
}

export interface WorldCupChampionProbability {
  teamId: string;
  name: string;
  probability: number;
  confidenceInterval: [number, number];
  drivers: string[];
}

export interface WorldCupForecast {
  tournament: string;
  simulations: number;
  rankings: WorldCupChampionProbability[];
  notes: string[];
}

export function forecastWorldCupChampion(input: {
  teams: WorldCupTeamInput[];
  simulations?: number;
  seed?: number;
  tournament?: string;
}): WorldCupForecast {
  const teams = input.teams.filter(t => t.rating > 0);
  const simulations = Math.max(200, input.simulations ?? 5000);
  const rng = seededRandom(input.seed ?? 2026);
  const strengths = teams.map(team => teamStrength(team));
  const totalStrength = strengths.reduce((sum, value) => sum + value, 0) || 1;
  const counts = new Map<string, number>(teams.map(team => [team.id, 0]));

  for (let i = 0; i < simulations; i++) {
    let mark = rng() * totalStrength;
    for (let idx = 0; idx < teams.length; idx++) {
      mark -= strengths[idx];
      if (mark <= 0 || idx === teams.length - 1) {
        counts.set(teams[idx].id, (counts.get(teams[idx].id) ?? 0) + 1);
        break;
      }
    }
  }

  const rankings = teams
    .map(team => {
      const probability = (counts.get(team.id) ?? 0) / simulations;
      const se = Math.sqrt((probability * (1 - probability)) / simulations);
      return {
        teamId: team.id,
        name: team.name,
        probability,
        confidenceInterval: [
          Math.max(0, probability - 1.96 * se),
          Math.min(1, probability + 1.96 * se),
        ] as [number, number],
        drivers: teamDrivers(team),
      };
    })
    .sort((a, b) => b.probability - a.probability);

  return {
    tournament: input.tournament ?? 'FIFA World Cup',
    simulations,
    rankings,
    notes: [
      'MVP uses a deterministic seeded tournament draw over rating-adjusted team strengths.',
      'Ratings, injuries, draw path and market calibration must be refreshed from external data before real-money use.',
    ],
  };
}

function teamStrength(team: WorldCupTeamInput): number {
  const ratingComponent = Math.exp((team.rating - 1800) / 350);
  const form = 1 + clamp(team.recentForm ?? 0, -1, 1) * 0.12;
  const health = 1 + clamp(team.squadHealth ?? 0, -1, 1) * 0.15;
  const path = 1 - clamp(team.pathDifficulty ?? 0, -1, 1) * 0.1;
  const market = team.marketImplied !== undefined ? 0.75 + clamp(team.marketImplied, 0, 1) : 1;
  return Math.max(0.0001, ratingComponent * form * health * path * market);
}

function teamDrivers(team: WorldCupTeamInput): string[] {
  const drivers = [`rating ${team.rating}`];
  if (team.recentForm !== undefined) drivers.push(`recent form ${team.recentForm.toFixed(2)}`);
  if (team.squadHealth !== undefined) drivers.push(`squad health ${team.squadHealth.toFixed(2)}`);
  if (team.pathDifficulty !== undefined) drivers.push(`path difficulty ${team.pathDifficulty.toFixed(2)}`);
  if (team.marketImplied !== undefined) drivers.push(`market implied ${team.marketImplied.toFixed(2)}`);
  return drivers;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
