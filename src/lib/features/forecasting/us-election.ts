export interface StateSignal {
  state: string;
  electoralVotes: number;
  margin: number;
  uncertainty?: number;
}

export interface PresidentialCandidateInput {
  id: string;
  name: string;
  party: string;
  nominationProbability: number;
  nationalPolling?: number;
  stateSignals?: StateSignal[];
  fundraisingIndex?: number;
  endorsementIndex?: number;
  fundamentalsIndex?: number;
  riskPenalty?: number;
  declared?: boolean;
}

export interface PresidentialCandidateProbability {
  candidateId: string;
  name: string;
  party: string;
  nominationProbability: number;
  generalElectionProbability: number;
  electionProbability: number;
  expectedElectoralVotes: number;
  uncertainty: string[];
  drivers: string[];
}

export interface PresidentialElectionForecast {
  electionYear: number;
  rankings: PresidentialCandidateProbability[];
  notes: string[];
}

export function forecastUsPresidentialElection(input: {
  electionYear: number;
  candidates: PresidentialCandidateInput[];
}): PresidentialElectionForecast {
  const rankings = input.candidates
    .map(candidate => {
      const stateEstimate = estimateElectoralCollege(candidate.stateSignals ?? []);
      const national = candidate.nationalPolling !== undefined
        ? logistic(candidate.nationalPolling / 7)
        : 0.5;
      const fundamentals = clamp01(0.5 + (candidate.fundamentalsIndex ?? 0) * 0.15);
      const organization = clamp01(
        0.5 + (candidate.fundraisingIndex ?? 0) * 0.08 + (candidate.endorsementIndex ?? 0) * 0.08
      );
      const sparsePenalty = candidate.stateSignals && candidate.stateSignals.length >= 10 ? 1 : 0.88;
      const risk = 1 - clamp01(candidate.riskPenalty ?? 0);
      const generalElectionProbability = clamp01(
        (stateEstimate.winProbability * 0.5 + national * 0.25 + fundamentals * 0.15 + organization * 0.1) *
          sparsePenalty *
          risk
      );
      const nominationProbability = clamp01(candidate.nominationProbability) * (candidate.declared === false ? 0.65 : 1);
      const electionProbability = nominationProbability * generalElectionProbability;
      return {
        candidateId: candidate.id,
        name: candidate.name,
        party: candidate.party,
        nominationProbability,
        generalElectionProbability,
        electionProbability,
        expectedElectoralVotes: stateEstimate.expectedElectoralVotes,
        uncertainty: uncertaintyNotes(candidate),
        drivers: drivers(candidate, stateEstimate.expectedElectoralVotes),
      };
    })
    .sort((a, b) => b.electionProbability - a.electionProbability);

  return {
    electionYear: input.electionYear,
    rankings,
    notes: [
      'Election probability is nomination probability multiplied by a structured general-election estimate.',
      'Sparse polls, undeclared candidates and legal or health risk are represented as scenario uncertainty, not overwritten by LLM preference.',
    ],
  };
}

function estimateElectoralCollege(signals: StateSignal[]): {
  expectedElectoralVotes: number;
  totalElectoralVotes: number;
  winProbability: number;
} {
  if (signals.length === 0) {
    return { expectedElectoralVotes: 269, totalElectoralVotes: 538, winProbability: 0.5 };
  }
  const totalElectoralVotes = signals.reduce((sum, s) => sum + s.electoralVotes, 0);
  const expectedElectoralVotes = signals.reduce((sum, s) => {
    const uncertainty = Math.max(1, s.uncertainty ?? 4);
    const winProbability = logistic(s.margin / uncertainty);
    return sum + s.electoralVotes * winProbability;
  }, 0);
  return {
    expectedElectoralVotes,
    totalElectoralVotes,
    winProbability: clamp01(expectedElectoralVotes / Math.max(1, totalElectoralVotes)),
  };
}

function uncertaintyNotes(candidate: PresidentialCandidateInput): string[] {
  const notes: string[] = [];
  if (candidate.declared === false) notes.push('candidate not declared');
  if (!candidate.stateSignals || candidate.stateSignals.length < 10) notes.push('sparse state polling');
  if (candidate.riskPenalty && candidate.riskPenalty > 0.15) notes.push('material legal/health/scandal risk');
  if (candidate.nationalPolling === undefined) notes.push('missing national polling');
  return notes.length > 0 ? notes : ['normal polling and fundamentals uncertainty'];
}

function drivers(candidate: PresidentialCandidateInput, expectedElectoralVotes: number): string[] {
  const out = [
    `nomination ${(clamp01(candidate.nominationProbability) * 100).toFixed(1)}%`,
    `expected EV ${expectedElectoralVotes.toFixed(1)}`,
  ];
  if (candidate.nationalPolling !== undefined) out.push(`national polling margin ${candidate.nationalPolling.toFixed(1)}`);
  if (candidate.fundraisingIndex !== undefined) out.push(`fundraising index ${candidate.fundraisingIndex.toFixed(2)}`);
  if (candidate.endorsementIndex !== undefined) out.push(`endorsement index ${candidate.endorsementIndex.toFixed(2)}`);
  return out;
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
