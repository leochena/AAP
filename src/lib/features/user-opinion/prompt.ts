import { ModelResponse, UserClaim } from '@/lib/types';

export function generateUserClaimReviewPrompt(input: {
  question: string;
  claim: UserClaim;
  blindResponses: ModelResponse[];
}): string {
  const responses = input.blindResponses
    .filter(r => !r.error && r.content)
    .map(r => {
      const body = r.content.length > 900 ? `${r.content.slice(0, 900)}...` : r.content;
      return `模型 ${r.modelId} 的盲审回答:\n"""\n${body}\n"""`;
    })
    .join('\n\n');

  const urls = input.claim.evidenceUrls.length > 0
    ? input.claim.evidenceUrls.map(u => `- ${u}`).join('\n')
    : '(用户未提供证据链接)';

  return `
你正在评审用户意见中的一条 claim。用户意见不是事实来源，也没有投票权；你的任务是判断它是否被证据和盲审回答支持。

【原始问题】
${input.question}

【用户 claim】
ID: ${input.claim.id}
类型: ${input.claim.type}
内容: ${input.claim.text}

【用户提供的证据链接】
${urls}

【模型盲审回答（这些回答是在看到用户意见之前生成的）】
${responses || '(没有可用盲审回答)'}

【判定要求】
1. 只基于原始问题、盲审回答、工具证据和用户给出的证据链接判断。
2. 如果用户 claim 只是偏好，只说明它是否是有效偏好，不要把偏好当事实。
3. 如果你在看到用户 claim 后改变判断，必须说明新增证据；没有新增证据不能附和。
4. 必须输出有效 JSON，不要输出解释性正文。

【输出格式】
\`\`\`json
{
  "stance": "support" | "refute" | "mixed" | "insufficient",
  "confidence": 0.0-1.0,
  "evidenceUsed": true,
  "reasoning": "50字以内，说明为什么采纳/反驳/不确定"
}
\`\`\`
`.trim();
}

export function parseUserClaimAssessmentResponse(
  response: string
): {
  stance: 'support' | 'refute' | 'mixed' | 'insufficient';
  confidence: number;
  evidenceUsed: boolean;
  reasoning?: string;
} | null {
  let jsonStr = response;
  const fenced = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) {
    jsonStr = fenced[1];
  } else {
    const obj = response.match(/\{[\s\S]*?\}/);
    if (obj) jsonStr = obj[0];
  }

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const stance = parsed.stance;
    if (
      stance !== 'support' &&
      stance !== 'refute' &&
      stance !== 'mixed' &&
      stance !== 'insufficient'
    ) {
      return null;
    }
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    return {
      stance,
      confidence: Math.max(0, Math.min(1, confidence)),
      evidenceUsed: parsed.evidenceUsed === true,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 200) : undefined,
    };
  } catch {
    return null;
  }
}
