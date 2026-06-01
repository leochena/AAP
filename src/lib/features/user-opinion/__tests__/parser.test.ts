import { describe, expect, it } from 'vitest';
import { extractUserClaims, normalizeUserOpinionInput } from '../parser';

describe('user opinion parser', () => {
  it('normalizes free text and extracts evidence urls', () => {
    const input = normalizeUserOpinionInput('我认为法国会夺冠。证据 https://example.com/report');
    expect(input).toEqual({
      text: '我认为法国会夺冠。证据 https://example.com/report',
      evidenceUrls: ['https://example.com/report'],
    });
  });

  it('splits user opinion into bounded claims', () => {
    const claims = extractUserClaims({
      text: '法国会夺冠。\n我更看重近期状态；也许伤病会改变结果。',
      evidenceUrls: ['https://example.com/a'],
    });
    expect(claims).toHaveLength(3);
    expect(claims[0]).toMatchObject({ id: 'uclaim-1', text: '法国会夺冠' });
    expect(claims.every(c => c.evidenceUrls.length === 1)).toBe(true);
  });

  it('creates an evidence claim when only urls are provided', () => {
    const claims = extractUserClaims({ text: 'https://example.com/a', evidenceUrls: [] });
    expect(claims).toHaveLength(1);
    expect(claims[0].type).toBe('evidence');
    expect(claims[0].evidenceUrls).toEqual(['https://example.com/a']);
  });
});
