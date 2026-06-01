import { describe, expect, it } from 'vitest';
import { generateUserClaimReviewPrompt, parseUserClaimAssessmentResponse } from '../prompt';

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

  it('includes fetched evidence summaries in review prompt', () => {
    const prompt = generateUserClaimReviewPrompt({
      question: 'Who will win?',
      claim: {
        id: 'uclaim-1',
        text: 'France will win',
        type: 'hypothesis',
        evidenceUrls: ['https://example.com/a'],
      },
      blindResponses: [],
      evidenceResults: [
        {
          url: 'https://example.com/a',
          status: 'fetched',
          ok: true,
          statusCode: 200,
          title: 'Ranking',
          preview: 'France has the highest rating.',
        },
      ],
    });

    expect(prompt).toContain('已抓取的证据状态与摘要');
    expect(prompt).toContain('France has the highest rating');
  });
});
