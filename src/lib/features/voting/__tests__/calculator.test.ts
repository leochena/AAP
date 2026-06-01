import { describe, it, expect } from 'vitest';
import { calculateVotingResult } from '../calculator';
import { ModelConfig, Vote, AdversarialConfig } from '@/lib/types';

function model(id: string, weight = 1): ModelConfig {
  return {
    id,
    protocol: 'openai',
    baseUrl: 'http://x',
    apiKey: '',
    model: id,
    weight,
    enabled: true,
  };
}

function vote(voterId: string, choice: string): Vote {
  return { voterId, choice, confidence: 1, timestamp: 0 };
}

const baseConfig: AdversarialConfig['voting'] = {
  enabled: true,
  mode: 'majority',
  threshold: 0.6,
  tiebreaker: 'first',
};

describe('calculateVotingResult', () => {
  it('selects the majority winner', () => {
    const r = calculateVotingResult({
      votes: [vote('a', 'a'), vote('b', 'a'), vote('c', 'b')],
      options: ['a', 'b', 'c'],
      models: new Map([['a', model('a')], ['b', model('b')], ['c', model('c')]]),
      config: baseConfig,
    });
    expect(r.winner).toBe('a');
    expect(r.totals).toEqual({ a: 2, b: 1, c: 0 });
    expect(r.isTie).toBe(false);
    expect(r.isUnanimous).toBe(false);
  });

  it('reports unanimous when every vote is for the same option', () => {
    const r = calculateVotingResult({
      votes: [vote('a', 'a'), vote('b', 'a'), vote('c', 'a')],
      options: ['a', 'b'],
      models: new Map([['a', model('a')], ['b', model('b')], ['c', model('c')]]),
      config: baseConfig,
    });
    expect(r.winner).toBe('a');
    expect(r.isUnanimous).toBe(true);
    expect(r.consensusLevel).toBe(1);
  });

  it('uses weights in weighted mode', () => {
    const r = calculateVotingResult({
      votes: [vote('heavy', 'a'), vote('light1', 'b'), vote('light2', 'b')],
      options: ['a', 'b'],
      models: new Map([
        ['heavy', model('heavy', 5)],
        ['light1', model('light1', 1)],
        ['light2', model('light2', 1)],
      ]),
      config: { ...baseConfig, mode: 'weighted' },
    });
    expect(r.totals).toEqual({ a: 5, b: 2 });
    expect(r.winner).toBe('a');
  });

  it('ignores weights in majority mode', () => {
    const r = calculateVotingResult({
      votes: [vote('heavy', 'a'), vote('light1', 'b'), vote('light2', 'b')],
      options: ['a', 'b'],
      models: new Map([
        ['heavy', model('heavy', 5)],
        ['light1', model('light1', 1)],
        ['light2', model('light2', 1)],
      ]),
      config: { ...baseConfig, mode: 'majority' },
    });
    expect(r.totals).toEqual({ a: 1, b: 2 });
    expect(r.winner).toBe('b');
  });

  it('uses explicit per-run vote weights for anti-sycophancy penalties', () => {
    const r = calculateVotingResult({
      votes: [vote('risk', 'a'), vote('steady1', 'b'), vote('steady2', 'b')],
      options: ['a', 'b'],
      models: new Map([
        ['risk', model('risk', 5)],
        ['steady1', model('steady1', 1)],
        ['steady2', model('steady2', 1)],
      ]),
      voteWeights: { risk: 0.5, steady1: 1, steady2: 1 },
      config: { ...baseConfig, mode: 'majority' },
    });
    expect(r.totals).toEqual({ a: 0.5, b: 2 });
    expect(r.winner).toBe('b');
  });

  it("breaks ties via 'first' tiebreaker", () => {
    const r = calculateVotingResult({
      votes: [vote('a', 'a'), vote('b', 'b')],
      options: ['a', 'b'],
      models: new Map([['a', model('a')], ['b', model('b')]]),
      config: { ...baseConfig, tiebreaker: 'first' },
    });
    expect(r.isTie).toBe(true);
    expect(r.winner).toBe('a');
    expect(r.requiresReview).toBe(true);
  });

  it("returns no winner with 'abstain' tiebreaker on tie", () => {
    const r = calculateVotingResult({
      votes: [vote('a', 'a'), vote('b', 'b')],
      options: ['a', 'b'],
      models: new Map([['a', model('a')], ['b', model('b')]]),
      config: { ...baseConfig, tiebreaker: 'abstain' },
    });
    expect(r.isTie).toBe(true);
    expect(r.winner).toBeUndefined();
  });

  it('discards votes for unknown options', () => {
    const r = calculateVotingResult({
      votes: [vote('a', 'a'), vote('b', 'ghost'), vote('c', 'a')],
      options: ['a', 'b'],
      models: new Map([['a', model('a')], ['b', model('b')], ['c', model('c')]]),
      config: baseConfig,
    });
    expect(r.totals).toEqual({ a: 2, b: 0 });
    expect(r.winner).toBe('a');
  });

  it('returns no winner when there are no votes', () => {
    const r = calculateVotingResult({
      votes: [],
      options: ['a', 'b'],
      models: new Map([['a', model('a')], ['b', model('b')]]),
      config: baseConfig,
    });
    expect(r.winner).toBeUndefined();
    expect(r.consensusLevel).toBe(0);
    expect(r.requiresReview).toBe(true);
  });

  it('flags requiresReview when consensus is below threshold', () => {
    const r = calculateVotingResult({
      votes: [vote('a', 'a'), vote('b', 'b'), vote('c', 'c')],
      options: ['a', 'b', 'c'],
      models: new Map([['a', model('a')], ['b', model('b')], ['c', model('c')]]),
      config: { ...baseConfig, threshold: 0.6 },
    });
    expect(r.consensusLevel).toBeCloseTo(1 / 3, 5);
    expect(r.requiresReview).toBe(true);
  });
});
