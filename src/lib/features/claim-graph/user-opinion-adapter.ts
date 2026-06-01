import {
  Challenge,
  ModelResponse,
  UserClaimAssessment,
  UserClaimVerdictStatus,
  UserOpinionResult,
} from '@/lib/types';
import {
  ClaimGraph,
  ClaimGraphBuilder,
  ClaimGraphEdgeRelation,
  claimGraphNodeId,
  createChallengeNode,
  createEvidenceNode,
  createModelClaimNode,
  createUserClaimNode,
  createVerdictNode,
} from './graph';

export function buildClaimGraphFromUserOpinion(input: {
  userOpinion: UserOpinionResult;
  responses?: ModelResponse[];
  challenges?: Challenge[];
}): ClaimGraph {
  const builder = new ClaimGraphBuilder();

  for (const claim of input.userOpinion.claims) {
    builder.addNode(
      createUserClaimNode({
        id: claim.id,
        text: claim.text,
        metadata: { claimType: claim.type, evidenceUrls: claim.evidenceUrls },
      })
    );
  }

  for (const evidence of input.userOpinion.evidenceResults) {
    const id = evidenceNodeInputId(evidence.url);
    builder.addNode(
      createEvidenceNode({
        id,
        title: evidence.title,
        url: evidence.url,
        summary: evidence.preview ?? evidence.error,
        reliability: evidence.ok ? 0.7 : 0.1,
        metadata: {
          status: evidence.status,
          ok: evidence.ok,
          statusCode: evidence.statusCode,
          contentType: evidence.contentType,
        },
      })
    );
    for (const claim of input.userOpinion.claims.filter(c => c.evidenceUrls.includes(evidence.url))) {
      const verdict = input.userOpinion.verdicts.find(v => v.claimId === claim.id);
      builder.addEdge({
        from: claimGraphNodeId('evidence', id),
        to: claimGraphNodeId('user_claim', claim.id),
        relation: evidenceRelation(evidence.ok, verdict?.status),
        strength: evidence.ok ? 0.7 : 0.2,
        source: evidence.url,
      });
    }
  }

  for (const assessment of input.userOpinion.assessments) {
    const id = modelClaimInputId(assessment);
    builder.addNode(
      createModelClaimNode({
        id,
        modelId: assessment.modelId,
        text: assessment.reasoning ?? `${assessment.modelId} assessed ${assessment.claimId}`,
        confidence: assessment.confidence,
        metadata: {
          claimId: assessment.claimId,
          stance: assessment.stance,
          evidenceUsed: assessment.evidenceUsed,
        },
      })
    );
    builder.addEdge({
      from: claimGraphNodeId('model_claim', id),
      to: claimGraphNodeId('user_claim', assessment.claimId),
      relation: assessmentRelation(assessment.stance),
      strength: assessment.confidence,
      source: assessment.modelId,
    });
  }

  for (const verdict of input.userOpinion.verdicts) {
    builder.addNode(
      createVerdictNode({
        id: verdict.claimId,
        status: verdict.status,
        confidence: verdict.consensus,
        text: verdict.reason,
      })
    );
    builder.addEdge({
      from: claimGraphNodeId('user_claim', verdict.claimId),
      to: claimGraphNodeId('verdict', verdict.claimId),
      relation: verdictRelation(verdict.status),
      strength: verdict.consensus,
      source: 'user-opinion-aggregator',
    });
  }

  for (const challenge of input.challenges ?? []) {
    builder.addNode(
      createChallengeNode({
        id: challenge.id,
        text: challenge.reason,
        challengerId: challenge.challengerId,
        targetId: challenge.targetId,
        severity: challenge.severity,
        metadata: { type: challenge.type, status: challenge.status },
      })
    );
  }

  return builder.build();
}

function evidenceNodeInputId(url: string): string {
  return encodeURIComponent(url).slice(0, 160);
}

function modelClaimInputId(assessment: UserClaimAssessment): string {
  return `${assessment.modelId}:${assessment.claimId}`;
}

function assessmentRelation(stance: UserClaimAssessment['stance']): ClaimGraphEdgeRelation {
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

function evidenceRelation(
  ok: boolean,
  status?: UserClaimVerdictStatus
): ClaimGraphEdgeRelation {
  if (!ok) return 'depends_on';
  if (status === 'rejected') return 'refutes';
  if (status === 'partial') return 'qualifies';
  return 'supports';
}

function verdictRelation(status: UserClaimVerdictStatus): ClaimGraphEdgeRelation {
  switch (status) {
    case 'adopted':
      return 'supports';
    case 'rejected':
      return 'refutes';
    case 'partial':
      return 'qualifies';
    case 'unresolved':
    default:
      return 'depends_on';
  }
}
