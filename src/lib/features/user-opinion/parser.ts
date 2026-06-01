import { UserClaim, UserOpinionInput } from '@/lib/types';

const URL_RE = /https?:\/\/[^\s)>"']+/gi;
const EVIDENCE_WORDS = /证据|链接|来源|source|evidence|according to|参考/i;
const PREFERENCE_WORDS = /我认为|我觉得|我希望|更看重|优先|prefer|preference|should|应该|最好/i;
const HYPOTHESIS_WORDS = /可能|也许|如果|假设|预测|预计|猜测|hypothesis|maybe|likely|probable/i;

export function normalizeUserOpinionInput(
  raw?: string | UserOpinionInput
): UserOpinionInput | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return undefined;
    return { text, evidenceUrls: extractUrls(text) };
  }
  const text = raw.text.trim();
  if (!text) return undefined;
  return {
    text,
    evidenceUrls: unique([...(raw.evidenceUrls ?? []), ...extractUrls(text)]),
  };
}

export function extractUserClaims(input: UserOpinionInput, maxClaims = 8): UserClaim[] {
  const evidenceUrls = unique([...(input.evidenceUrls ?? []), ...extractUrls(input.text)]);
  const withoutUrls = input.text.replace(URL_RE, ' ').trim();
  const parts = splitClaims(withoutUrls).slice(0, maxClaims);

  if (parts.length === 0 && evidenceUrls.length > 0) {
    return [
      {
        id: 'uclaim-1',
        text: '用户提供了外部证据链接，需要模型核验其是否支持原问题中的结论。',
        type: 'evidence',
        evidenceUrls,
      },
    ];
  }

  return parts.map((text, idx) => ({
    id: `uclaim-${idx + 1}`,
    text,
    type: classifyClaim(text, evidenceUrls),
    evidenceUrls,
  }));
}

function splitClaims(text: string): string[] {
  return unique(
    text
      .split(/\r?\n|[。！？!?；;]+/g)
      .map(s => s.replace(/^[-*•\d.)、\s]+/, '').trim())
      .filter(s => s.length > 0)
      .map(s => (s.length > 500 ? `${s.slice(0, 500)}...` : s))
  );
}

function classifyClaim(text: string, evidenceUrls: string[]): UserClaim['type'] {
  if (EVIDENCE_WORDS.test(text) || evidenceUrls.length > 0) return 'evidence';
  if (PREFERENCE_WORDS.test(text)) return 'preference';
  if (HYPOTHESIS_WORDS.test(text)) return 'hypothesis';
  return 'fact';
}

function extractUrls(text: string): string[] {
  return unique(text.match(URL_RE) ?? []);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}
