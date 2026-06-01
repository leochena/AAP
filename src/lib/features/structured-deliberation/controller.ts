import {
  BlackboardClaim,
  BlackboardEvidenceRef,
  ConsensusRiskSignal,
  IdentityDriftSignal,
  MinorityProtectionSignal,
  ModelConfig,
  ModelResponse,
  StructuredConsensusCluster,
  StructuredDeliberationEvent,
  StructuredDeliberationResult,
  StructuredRevisionDirective,
} from '@/lib/types';

export interface BuildStructuredDeliberationInput {
  question: string;
  models: ModelConfig[];
  responses: ModelResponse[];
  runId?: string;
}

interface ClaimCluster {
  id: string;
  claims: BlackboardClaim[];
  fingerprint: string;
}

const MAX_CLAIMS_PER_MODEL = 3;

export function buildStructuredDeliberation(
  input: BuildStructuredDeliberationInput
): StructuredDeliberationResult {
  const runtimeByModel = new Map(input.models.map(model => [model.id, runtimeIdentity(model)]));
  const claims = input.responses.flatMap(response => extractClaims(response));
  const evidenceRefs = extractEvidenceRefs(claims);
  const identityDriftSignals = input.responses.flatMap(response =>
    detectIdentityDrift(response, runtimeByModel.get(response.modelId) ?? response.modelId)
  );
  const consensusClusters = buildConsensusClusters(claims, evidenceRefs);
  const consensusRisks = buildConsensusRisks(consensusClusters);
  const minorityProtection = buildMinorityProtection(claims, consensusClusters, consensusRisks);
  const revisionDirectives = buildRevisionDirectives(identityDriftSignals, consensusRisks, minorityProtection);
  const events = buildEvents({
    claims,
    evidenceRefs,
    identityDriftSignals,
    consensusRisks,
    minorityProtection,
    revisionDirectives,
  });
  const reviewReasons = [
    ...identityDriftSignals.map(signal => `identity drift: ${signal.modelId} claimed ${signal.claimedIdentity}`),
    ...consensusRisks.map(signal => signal.reason),
    ...minorityProtection.map(signal => signal.reason),
  ];

  return {
    claims,
    evidenceRefs,
    consensusClusters,
    identityDriftSignals,
    consensusRisks,
    minorityProtection,
    revisionDirectives,
    events,
    reviewReasons,
    summary: summarize({ claims, consensusRisks, identityDriftSignals, minorityProtection, revisionDirectives }),
  };
}

function extractClaims(response: ModelResponse): BlackboardClaim[] {
  if (response.error || !response.content.trim()) return [];
  const urls = extractUrls(response.content);
  return candidateClaimTexts(response.content).slice(0, MAX_CLAIMS_PER_MODEL).map((text, index) => ({
    id: `claim:${response.modelId}:${index + 1}`,
    modelId: response.modelId,
    text,
    fingerprint: fingerprint(text),
    confidence: inferClaimConfidence(text, urls.length),
    evidenceRefs: urls,
    uncertainty: hasUncertainty(text),
  }));
}

function candidateClaimTexts(content: string): string[] {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\n+|(?<=[。！？.!?])\s+/)
    .map(line => line.replace(/^[-*#>\s\d.、:：]+/, '').trim())
    .filter(line => line.length >= 18 && line.length <= 700)
    .filter(line => !/^https?:\/\//i.test(line));
  return uniqueBy(cleaned, line => fingerprint(line));
}

function extractEvidenceRefs(claims: BlackboardClaim[]): BlackboardEvidenceRef[] {
  const refs = new Map<string, BlackboardEvidenceRef>();
  for (const claim of claims) {
    for (const url of claim.evidenceRefs) {
      const id = `evidence:${stableId(url)}`;
      const existing = refs.get(id);
      if (existing) {
        if (!existing.claimIds.includes(claim.id)) existing.claimIds.push(claim.id);
        continue;
      }
      refs.set(id, {
        id,
        sourceModelId: claim.modelId,
        url,
        host: safeHost(url),
        claimIds: [claim.id],
      });
    }
  }
  return [...refs.values()];
}

function detectIdentityDrift(
  response: ModelResponse,
  runtime: string
): IdentityDriftSignal[] {
  if (response.error || !response.content.trim()) return [];
  const runtimeFamilies = identityFamilies(runtime);
  const claims = claimedIdentities(response.content);
  return claims
    .filter(claim => !runtimeFamilies.has(claim.family))
    .map((claim, index) => ({
      id: `identity:${response.modelId}:${index + 1}`,
      modelId: response.modelId,
      runtimeIdentity: runtime,
      claimedIdentity: claim.label,
      severity: 'high' as const,
      evidenceText: claim.evidenceText,
      reason: `Runtime configured this participant as ${runtime}, but its output claimed ${claim.label}.`,
    }));
}

function buildConsensusClusters(
  claims: BlackboardClaim[],
  evidenceRefs: BlackboardEvidenceRef[]
): StructuredConsensusCluster[] {
  const clusters: ClaimCluster[] = [];
  for (const claim of claims) {
    const match = clusters.find(cluster => isSimilarFingerprint(cluster.fingerprint, claim.fingerprint));
    if (match) {
      match.claims.push(claim);
      continue;
    }
    clusters.push({
      id: `cluster:${clusters.length + 1}`,
      claims: [claim],
      fingerprint: claim.fingerprint,
    });
  }

  return clusters.map(cluster => {
    const evidenceHosts = new Set(
      evidenceRefs
        .filter(ref => ref.claimIds.some(claimId => cluster.claims.some(claim => claim.id === claimId)))
        .map(ref => ref.host)
        .filter(Boolean)
    );
    const independentEvidenceCount = evidenceHosts.size;
    const modelIds = unique(cluster.claims.map(claim => claim.modelId));
    return {
      id: cluster.id,
      modelIds,
      claimIds: cluster.claims.map(claim => claim.id),
      fingerprint: cluster.fingerprint,
      independentEvidenceCount,
      risk: consensusRisk(modelIds.length, independentEvidenceCount),
    };
  });
}

function buildConsensusRisks(clusters: StructuredConsensusCluster[]): ConsensusRiskSignal[] {
  return clusters
    .filter(cluster => cluster.risk !== 'none')
    .map(cluster => ({
      id: `risk:${cluster.id}`,
      clusterId: cluster.id,
      modelIds: cluster.modelIds,
      claimIds: cluster.claimIds,
      independentEvidenceCount: cluster.independentEvidenceCount,
      severity: cluster.risk === 'high' ? 'high' : cluster.risk === 'medium' ? 'medium' : 'low',
      reason:
        `${cluster.modelIds.length} models converged on similar claims with ` +
        `${cluster.independentEvidenceCount} independent evidence source(s); consensus must not be treated as truth.`,
    }));
}

function buildMinorityProtection(
  claims: BlackboardClaim[],
  clusters: StructuredConsensusCluster[],
  risks: ConsensusRiskSignal[]
): MinorityProtectionSignal[] {
  if (risks.length === 0) return [];
  const largestRisk = risks
    .map(risk => clusters.find(cluster => cluster.id === risk.clusterId))
    .filter((cluster): cluster is StructuredConsensusCluster => cluster !== undefined)
    .sort((a, b) => b.modelIds.length - a.modelIds.length)[0];
  if (!largestRisk || largestRisk.modelIds.length < 2) return [];

  return claims
    .filter(claim => !largestRisk.claimIds.includes(claim.id))
    .map(claim => ({
      id: `minority:${claim.id}`,
      modelId: claim.modelId,
      claimId: claim.id,
      againstClusterId: largestRisk.id,
      severity: 'medium' as const,
      reason: `${claim.modelId}'s divergent claim is protected from majority overwrite until the consensus cluster resolves independent evidence gaps.`,
    }));
}

function buildRevisionDirectives(
  identity: IdentityDriftSignal[],
  risks: ConsensusRiskSignal[],
  minority: MinorityProtectionSignal[]
): StructuredRevisionDirective[] {
  const directives: StructuredRevisionDirective[] = [];
  for (const signal of identity) {
    directives.push({
      id: `rev:${signal.id}`,
      modelId: signal.modelId,
      targetClaimIds: [],
      reason: signal.reason,
      required: true,
    });
  }
  for (const risk of risks) {
    for (const modelId of risk.modelIds) {
      directives.push({
        id: `rev:${risk.id}:${modelId}`,
        modelId,
        targetClaimIds: risk.claimIds,
        reason: 'Consensus cluster needs independent evidence or explicit uncertainty before final adjudication.',
        required: risk.severity !== 'low',
      });
    }
  }
  for (const signal of minority) {
    directives.push({
      id: `rev:${signal.id}`,
      modelId: signal.modelId,
      targetClaimIds: [signal.claimId],
      reason: 'Minority claim preserved for forced adjudication against the majority cluster.',
      required: false,
    });
  }
  return directives;
}

function buildEvents(input: {
  claims: BlackboardClaim[];
  evidenceRefs: BlackboardEvidenceRef[];
  identityDriftSignals: IdentityDriftSignal[];
  consensusRisks: ConsensusRiskSignal[];
  minorityProtection: MinorityProtectionSignal[];
  revisionDirectives: StructuredRevisionDirective[];
}): StructuredDeliberationEvent[] {
  const events: StructuredDeliberationEvent[] = [];
  for (const claim of input.claims) {
    events.push({
      id: `event:${claim.id}`,
      round: 1,
      actorId: claim.modelId,
      action: 'propose_claim',
      targetId: claim.id,
      payload: claim as unknown as Record<string, unknown>,
      summary: `${claim.modelId} proposed ${claim.id}`,
    });
  }
  for (const evidence of input.evidenceRefs) {
    events.push({
      id: `event:${evidence.id}`,
      round: 1,
      actorId: evidence.sourceModelId,
      action: 'register_evidence',
      targetId: evidence.id,
      payload: evidence as unknown as Record<string, unknown>,
      summary: `${evidence.sourceModelId} registered evidence host ${evidence.host}`,
    });
  }
  for (const signal of input.identityDriftSignals) {
    events.push({
      id: `event:${signal.id}`,
      round: 1,
      actorId: 'controller',
      action: 'flag_identity_drift',
      targetId: signal.modelId,
      payload: signal as unknown as Record<string, unknown>,
      summary: `identity drift flagged for ${signal.modelId}`,
    });
  }
  for (const signal of input.consensusRisks) {
    events.push({
      id: `event:${signal.id}`,
      round: 1,
      actorId: 'controller',
      action: 'flag_consensus_risk',
      targetId: signal.clusterId,
      payload: signal as unknown as Record<string, unknown>,
      summary: `consensus risk flagged for ${signal.clusterId}`,
    });
  }
  for (const signal of input.minorityProtection) {
    events.push({
      id: `event:${signal.id}`,
      round: 1,
      actorId: 'controller',
      action: 'protect_minority',
      targetId: signal.claimId,
      payload: signal as unknown as Record<string, unknown>,
      summary: `minority claim ${signal.claimId} protected`,
    });
  }
  for (const directive of input.revisionDirectives) {
    events.push({
      id: `event:${directive.id}`,
      round: 1,
      actorId: 'controller',
      action: 'request_revision',
      targetId: directive.modelId,
      payload: directive as unknown as Record<string, unknown>,
      summary: `revision directive for ${directive.modelId}`,
    });
  }
  return events;
}

function runtimeIdentity(model: ModelConfig): string {
  return `${model.id} ${model.protocol} ${model.model} ${model.baseUrl}`;
}

function claimedIdentities(content: string): Array<{ family: string; label: string; evidenceText: string }> {
  const out: Array<{ family: string; label: string; evidenceText: string }> = [];
  const patterns: Array<[RegExp, string, string]> = [
    [/(?:我是|我叫|作为|我是由|由).{0,24}(千问|通义|qwen)/i, 'qwen', 'Qwen/千问'],
    [/(?:我是|我叫|作为|我是由|由).{0,24}(claude|anthropic|opus)/i, 'claude', 'Claude/Anthropic'],
    [/(?:我是|我叫|作为|我是由|由).{0,24}(chatgpt|openai|gpt-?[45]?)/i, 'openai', 'OpenAI/GPT'],
    [/(?:我是|我叫|作为|我是由|由).{0,24}(deepseek|深度求索)/i, 'deepseek', 'DeepSeek'],
    [/(?:我是|我叫|作为|我是由|由).{0,24}(gemini|google)/i, 'gemini', 'Gemini/Google'],
    [/\bI am (?:an? )?.{0,24}(Qwen|Claude|ChatGPT|GPT|DeepSeek|Gemini|Opus)\b/i, 'auto', ''],
  ];
  for (const [pattern, family, label] of patterns) {
    const match = content.match(pattern);
    if (!match) continue;
    const raw = match[1] ?? match[0];
    out.push({
      family: family === 'auto' ? identityFamily(raw) : family,
      label: label || raw,
      evidenceText: truncate(match[0].trim(), 180),
    });
  }
  return uniqueBy(out, item => `${item.family}:${item.evidenceText}`);
}

function identityFamilies(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const families = new Set<string>();
  for (const token of ['qwen', '千问', '通义']) if (normalized.includes(token)) families.add('qwen');
  for (const token of ['claude', 'anthropic', 'opus']) if (normalized.includes(token)) families.add('claude');
  for (const token of ['openai', 'gpt', 'chatgpt']) if (normalized.includes(token)) families.add('openai');
  for (const token of ['deepseek', '深度求索']) if (normalized.includes(token)) families.add('deepseek');
  for (const token of ['gemini', 'google']) if (normalized.includes(token)) families.add('gemini');
  return families.size > 0 ? families : new Set(['unknown']);
}

function identityFamily(value: string): string {
  return [...identityFamilies(value)][0] ?? 'unknown';
}

function extractUrls(value: string): string[] {
  return unique(value.match(/https?:\/\/[^\s)\]}>"']+/g) ?? []);
}

function fingerprint(value: string): string {
  const tokens = tokenize(value)
    .filter(token => !STOPWORDS.has(token))
    .slice(0, 14);
  return tokens.join(' ');
}

function tokenize(value: string): string[] {
  const ascii = value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .match(/[a-z0-9][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  const out: string[] = [];
  for (const token of ascii) {
    if (/^[\u4e00-\u9fff]+$/.test(token) && token.length > 4) {
      for (let i = 0; i < token.length - 1; i += 2) out.push(token.slice(i, i + 2));
    } else {
      out.push(token);
    }
  }
  return unique(out);
}

function isSimilarFingerprint(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const left = new Set(a.split(/\s+/).filter(Boolean));
  const right = new Set(b.split(/\s+/).filter(Boolean));
  const intersection = [...left].filter(token => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union > 0 && intersection / union >= 0.42;
}

function consensusRisk(modelCount: number, evidenceCount: number): 'none' | 'low' | 'medium' | 'high' {
  if (modelCount < 2) return 'none';
  if (evidenceCount === 0) return 'high';
  if (evidenceCount === 1) return 'medium';
  return 'low';
}

function inferClaimConfidence(text: string, evidenceCount: number): number {
  const base = hasUncertainty(text) ? 0.45 : 0.6;
  return clamp01(base + Math.min(evidenceCount, 3) * 0.08);
}

function hasUncertainty(text: string): boolean {
  return /不确定|无法确定|可能|大概|maybe|uncertain|not enough|insufficient/i.test(text);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function stableId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function summarize(input: {
  claims: BlackboardClaim[];
  consensusRisks: ConsensusRiskSignal[];
  identityDriftSignals: IdentityDriftSignal[];
  minorityProtection: MinorityProtectionSignal[];
  revisionDirectives: StructuredRevisionDirective[];
}): string {
  return (
    `blackboard claims=${input.claims.length}, ` +
    `consensusRisks=${input.consensusRisks.length}, ` +
    `identityDrift=${input.identityDriftSignals.length}, ` +
    `minorityProtected=${input.minorityProtection.length}, ` +
    `revisionDirectives=${input.revisionDirectives.length}`
  );
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(item);
  }
  return out;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'with',
  'this',
  'from',
  'are',
  'was',
  'were',
  'will',
  'would',
  'should',
  'because',
  'therefore',
  '但是',
  '因此',
  '所以',
  '可能',
  '认为',
  '结论',
]);
