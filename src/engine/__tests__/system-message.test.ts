import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdversarialEngine } from '../AdversarialEngine';
import type { ModelConfig, RunRequest, AdversarialConfig } from '@/lib/types';

const adversarialConfig: AdversarialConfig = {
  autoChallenge: { enabled: false, threshold: 0.7, maxChallengesPerRound: 3 },
  voting: { enabled: false, mode: 'weighted', threshold: 0.5, tiebreaker: 'first' },
  maxRounds: 1,
  tools: {
    enabled: false,
    searxngUrl: 'http://127.0.0.1:28080',
    searchEngines: 'bing',
    fetchUrl: { enabled: true, maxBytes: 4096, timeoutMs: 10000 },
    codeExec: { enabled: true, image: 'python:3.12-slim', timeoutMs: 10000, memoryMb: 256, cpus: '0.5' },
    concede: { enabled: true },
    maxToolCallsPerGeneration: 6,
    capabilityCacheHours: 24,
  },
};

const model: ModelConfig = {
  id: 'm1',
  protocol: 'openai',
  baseUrl: 'http://example.com/v1',
  apiKey: 'sk',
  model: 'mock',
  enabled: true,
};

const baseRequest: RunRequest = {
  question: 'q?',
  modelIds: ['m1'],
  source: 'tui-input',
};

describe('AdversarialEngine.buildSystemMessage', () => {
  let originalDate: typeof Date;
  beforeEach(() => {
    originalDate = global.Date;
  });
  afterEach(() => {
    global.Date = originalDate;
    vi.restoreAllMocks();
  });

  it('includes the current ISO date', () => {
    const engine = new AdversarialEngine({
      request: baseRequest,
      models: [model],
      adversarialConfig,
      storageDir: '/tmp/aap-test',
    });
    const fixed = new Date('2026-05-02T12:34:56Z');
    const msg = (engine as unknown as { buildSystemMessage: (d?: Date) => { role: string; content: string } })
      .buildSystemMessage(fixed);
    expect(msg.role).toBe('system');
    expect(msg.content).toContain('2026-05-02');
    expect(msg.content).toContain('当前日期');
  });

  it('omits tool guidance when tools are disabled', () => {
    const engine = new AdversarialEngine({
      request: baseRequest,
      models: [model],
      adversarialConfig: { ...adversarialConfig, tools: { ...adversarialConfig.tools, enabled: false } },
      storageDir: '/tmp/aap-test',
    });
    const msg = (engine as unknown as { buildSystemMessage: () => { content: string } })
      .buildSystemMessage();
    expect(msg.content).not.toContain('search(query)');
    expect(msg.content).not.toContain('concede');
  });

  it('includes tool guidance when tools are enabled', () => {
    const engine = new AdversarialEngine({
      request: baseRequest,
      models: [model],
      adversarialConfig: { ...adversarialConfig, tools: { ...adversarialConfig.tools, enabled: true } },
      storageDir: '/tmp/aap-test',
    });
    const msg = (engine as unknown as { buildSystemMessage: () => { content: string } })
      .buildSystemMessage();
    expect(msg.content).toContain('search(query)');
    expect(msg.content).toContain('exec_python(code)');
    expect(msg.content).toContain('concede');
    expect(msg.content).toContain('求真');
    // 反伪证据原则
    expect(msg.content).toMatch(/不要编造|不要假设/);
  });

  it('can suppress tool guidance for text-only models in a mixed run', () => {
    const engine = new AdversarialEngine({
      request: baseRequest,
      models: [model],
      adversarialConfig: { ...adversarialConfig, tools: { ...adversarialConfig.tools, enabled: true } },
      storageDir: '/tmp/aap-test',
    });
    const msg = (engine as unknown as { buildSystemMessage: (d?: Date, toolsAvailable?: boolean) => { content: string } })
      .buildSystemMessage(new Date('2026-05-02T12:34:56Z'), false);
    expect(msg.content).not.toContain('search(query)');
    expect(msg.content).not.toContain('concede');
  });
});
