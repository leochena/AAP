import { describe, expect, it } from 'vitest';
import { parseUserClaimAssessmentResponse } from '../prompt';

describe('user claim assessment parser', () => {
  it('parses fenced JSON', () => {
    const parsed = parseUserClaimAssessmentResponse(
      '```json\n{"stance":"refute","confidence":0.8,"evidenceUsed":true,"reasoning":"证据不支持"}\n```'
    );
    expect(parsed).toEqual({
      stance: 'refute',
      confidence: 0.8,
      evidenceUsed: true,
      reasoning: '证据不支持',
    });
  });

  it('rejects invalid stance', () => {
    const parsed = parseUserClaimAssessmentResponse(
      '{"stance":"agree","confidence":0.8,"evidenceUsed":true}'
    );
    expect(parsed).toBeNull();
  });

  it('clamps confidence', () => {
    const parsed = parseUserClaimAssessmentResponse(
      '{"stance":"support","confidence":2,"evidenceUsed":false}'
    );
    expect(parsed?.confidence).toBe(1);
  });
});
