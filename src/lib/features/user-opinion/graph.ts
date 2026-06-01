import {
  Challenge,
  DebateGraph,
  DebateGraphEdge,
  DebateGraphNode,
  EvidenceFetchResult,
  ModelResponse,
  UserClaim,
  UserClaimAssessment,
  UserClaimVerdict,
} from '@/lib/types';

export function buildDebateGraph(input: {
  claims: UserClaim[];
  evidenceResults: EvidenceFetchResult[];
  assessments: UserClaimAssessment[];
  verdicts: UserClaimVerdict[];
  blindResponses: ModelResponse[];
  finalResponses: ModelResponse[];
  challenges?: Challenge[];
}): DebateGraph {
  const nodes: DebateGraphNode[] = [];
  const edges: DebateGraphEdge[] = [];

  for (const claim of input.claims) {
    nodes.push({
      id: claimNodeId(claim.id),
      type: 'user_claim',
      label: claim.text,
      refId: claim.id,
      meta: { claimType: claim.type },
    });
  }

  for (const response of input.blindResponses) {
    if (response.error) continue;
    nodes.push({
      id: answerNodeId(response.modelId, 'blind'),
      type: 'model_answer',
      label: `${response.modelId} blind answer`,
      refId: response.modelId,
      meta: { stage: 'blind', tokens: response.tokensIn + response.tokensOut },
    });
  }

  for (const response of input.finalResponses) {
    if (response.error) continue;
    nodes.push({
      id: answerNodeId(response.modelId, 'final'),
      type: 'model_answer',
      label: `${response.modelId} final answer`,
      refId: response.modelId,
      meta: { stage: 'final', tokens: response.tokensIn + response.tokensOut },
    });
    edges.push({
      from: answerNodeId(response.modelId, 'blind'),
      to: answerNodeId(response.modelId, 'final'),
      relation: 'produces',
      strength: 1,
      source: response.modelId,
    });
  }

  for (const evidence of input.evidenceResults) {
    nodes.push({
      id: evidenceNodeId(evidence.url),
      type: 'evidence',
      label: evidence.title || evidence.url,
      refId: evidence.url,
      meta: { status: evidence.status, ok: evidence.ok, statusCode: evidence.statusCode },
    });
    for (const claim of input.claims.filter(c => c.evidenceUrls.includes(evidence.url))) {
      edges.push({
        from: evidenceNodeId(evidence.url),
        to: claimNodeId(claim.id),
        relation: evidence.ok ? 'supports' : 'qualifies',
        strength: evidence.ok ? 0.6 : 0.2,
        source: evidence.url,
      });
    }
  }

  for (const assessment of input.assessments) {
    const relation = assessmentRelation(assessment.stance);
    edges.push({
      from: answerNodeId(assessment.modelId, 'blind'),
      to: claimNodeId(assessment.claimId),
      relation,
      strength: assessment.confidence,
      source: assessment.modelId,
    });
  }

  for (const verdict of input.verdicts) {
    const id = verdictNodeId(verdict.claimId);
    nodes.push({
      id,
      type: 'verdict',
      label: `${verdict.claimId}: ${verdict.status}`,
      refId: verdict.claimId,
      meta: { status: verdict.status, consensus: verdict.consensus },
    });
    edges.push({
      from: claimNodeId(verdict.claimId),
      to: id,
      relation: 'produces',
      strength: verdict.consensus,
      source: 'user-opinion-aggregator',
    });
  }

  for (const challenge of input.challenges ?? []) {
    const id = `challenge:${challenge.id}`;
    nodes.push({
      id,
      type: 'challenge',
      label: challenge.reason,
      refId: challenge.id,
      meta: { type: challenge.type, severity: challenge.severity },
    });
    edges.push({
      from: answerNodeId(challenge.challengerId, 'final'),
      to: id,
      relation: 'produces',
      strength: challenge.confidence,
      source: challenge.challengerId,
    });
    edges.push({
      from: id,
      to: answerNodeId(challenge.targetId, 'final'),
      relation: 'refutes',
      strength: challenge.confidence,
      source: challenge.challengerId,
    });
  }

  return { nodes: dedupeNodes(nodes), edges: dedupeEdges(edges) };
}

function assessmentRelation(stance: UserClaimAssessment['stance']): DebateGraphEdge['relation'] {
  switch (stance) {
    case 'support':
      return 'supports';
    case 'refute':
      return 'refutes';
    case 'mixed':
      return 'qualifies';
    case 'insufficient':
    default:
      return 'depends_on';
  }
}

function claimNodeId(id: string): string {
  return `claim:${id}`;
}

function answerNodeId(modelId: string, stage: 'blind' | 'final'): string {
  return `answer:${stage}:${modelId}`;
}

function evidenceNodeId(url: string): string {
  return `evidence:${url}`;
}

function verdictNodeId(claimId: string): string {
  return `verdict:${claimId}`;
}

function dedupeNodes(nodes: DebateGraphNode[]): DebateGraphNode[] {
  return [...new Map(nodes.map(node => [node.id, node])).values()];
}

function dedupeEdges(edges: DebateGraphEdge[]): DebateGraphEdge[] {
  return [...new Map(edges.map(edge => [`${edge.from}|${edge.to}|${edge.relation}|${edge.source}`, edge])).values()];
}
