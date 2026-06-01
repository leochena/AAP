import { describe, expect, it } from 'vitest';
import {
  ClaimGraphBuilder,
  claimGraphNodeId,
  createChallengeNode,
  createEvidenceNode,
  createModelClaimNode,
  createUserClaimNode,
  createVerdictNode,
  extractEvidenceChains,
  summarizeClaimGraphQuality,
  traceClaimGraphPaths,
} from '../graph';

describe('claim graph node helpers', () => {
  it('creates generic protocol nodes with stable type-prefixed ids', () => {
    const userClaim = createUserClaimNode({
      id: 'u1',
      text: 'The proposal is supported by the cited source.',
      claimantId: 'operator',
    });
    const modelClaim = createModelClaimNode({
      id: 'm1',
      modelId: 'model-a',
      text: 'The source partially supports the proposal.',
      stage: 'blind',
      confidence: 0.72,
    });
    const evidence = createEvidenceNode({
      id: 'e1',
      title: 'Primary source',
      url: 'https://example.test/source',
      reliability: 0.8,
    });
    const challenge = createChallengeNode({
      id: 'c1',
      text: 'The source does not cover the full claim.',
      severity: 'medium',
    });
    const verdict = createVerdictNode({
      id: 'v1',
      status: 'partially_supported',
      confidence: 0.64,
    });

    expect(userClaim).toMatchObject({
      id: 'user_claim:u1',
      type: 'user_claim',
      label: 'The proposal is supported by the cited source.',
      metadata: { claimantId: 'operator' },
    });
    expect(modelClaim.metadata).toMatchObject({
      modelId: 'model-a',
      stage: 'blind',
      confidence: 0.72,
    });
    expect(evidence).toMatchObject({
      id: 'evidence:e1',
      ref: 'https://example.test/source',
      metadata: { reliability: 0.8 },
    });
    expect(challenge.type).toBe('challenge');
    expect(verdict.metadata.status).toBe('partially_supported');
    expect(claimGraphNodeId('verdict', 'v1')).toBe('verdict:v1');
  });
});

describe('ClaimGraphBuilder', () => {
  it('builds and deduplicates a lightweight directed graph', () => {
    const userClaim = createUserClaimNode({ id: 'u1', text: 'Claim under review' });
    const evidence = createEvidenceNode({ id: 'e1', title: 'Evidence' });
    const verdict = createVerdictNode({ id: 'v1', status: 'supported' });

    const graph = new ClaimGraphBuilder()
      .addNodes([userClaim, evidence, verdict])
      .supports(evidence.id, userClaim.id, { strength: 0.9, source: evidence.id })
      .supports(evidence.id, userClaim.id, { strength: 0.9, source: evidence.id })
      .qualifies(userClaim.id, verdict.id, { strength: 0.7 })
      .build();

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({
      from: evidence.id,
      to: userClaim.id,
      relation: 'supports',
      strength: 0.9,
    });
  });

  it('rejects edges whose endpoints are not in the graph', () => {
    const userClaim = createUserClaimNode({ id: 'u1', text: 'Claim under review' });
    const builder = new ClaimGraphBuilder().addNode(userClaim);

    expect(() => builder.refutes('evidence:missing', userClaim.id)).toThrow(
      /unknown node/
    );
  });
});

describe('claim graph traversal', () => {
  it('traces directed support paths and extracts evidence chains', () => {
    const userClaim = createUserClaimNode({ id: 'u1', text: 'Claim under review' });
    const modelClaim = createModelClaimNode({
      id: 'm1',
      modelId: 'model-a',
      text: 'Model claim',
    });
    const evidence = createEvidenceNode({ id: 'e1', title: 'Evidence' });

    const graph = new ClaimGraphBuilder()
      .addNodes([evidence, modelClaim, userClaim])
      .supports(evidence.id, modelClaim.id, { strength: 0.8 })
      .qualifies(modelClaim.id, userClaim.id, { strength: 0.6 })
      .build();

    const paths = traceClaimGraphPaths(graph, {
      from: evidence.id,
      to: userClaim.id,
    });
    const chains = extractEvidenceChains(graph, userClaim.id);

    expect(paths).toHaveLength(1);
    expect(paths[0].nodes.map(node => node.id)).toEqual([
      evidence.id,
      modelClaim.id,
      userClaim.id,
    ]);
    expect(paths[0].relations).toEqual(['supports', 'qualifies']);
    expect(paths[0].strength).toBe(0.6);
    expect(chains).toHaveLength(1);
    expect(chains[0].evidence.id).toBe(evidence.id);
    expect(chains[0].target.id).toBe(userClaim.id);
  });

  it('avoids cycles and honors relation filters', () => {
    const a = createUserClaimNode({ id: 'a', text: 'A' });
    const b = createModelClaimNode({ id: 'b', modelId: 'model-b', text: 'B' });
    const evidence = createEvidenceNode({ id: 'e', title: 'Evidence' });

    const graph = new ClaimGraphBuilder()
      .addNodes([evidence, a, b])
      .supports(evidence.id, b.id)
      .supports(b.id, a.id)
      .dependsOn(a.id, b.id)
      .build();

    expect(
      traceClaimGraphPaths(graph, {
        from: evidence.id,
        to: a.id,
        relations: ['supports'],
      })
    ).toHaveLength(1);
    expect(
      traceClaimGraphPaths(graph, {
        from: evidence.id,
        to: a.id,
        relations: ['refutes'],
      })
    ).toEqual([]);
  });
});

describe('summarizeClaimGraphQuality', () => {
  it('reports evidence coverage plus support, refute, and conflict counts', () => {
    const supportedClaim = createUserClaimNode({ id: 'u1', text: 'Supported claim' });
    const conflictedClaim = createUserClaimNode({ id: 'u2', text: 'Conflicted claim' });
    const evidenceA = createEvidenceNode({ id: 'e1', title: 'Evidence A' });
    const evidenceB = createEvidenceNode({ id: 'e2', title: 'Evidence B' });
    const challenge = createChallengeNode({ id: 'c1', text: 'Challenge' });
    const verdict = createVerdictNode({ id: 'v1', status: 'mixed' });

    const graph = new ClaimGraphBuilder()
      .addNodes([supportedClaim, conflictedClaim, evidenceA, evidenceB, challenge, verdict])
      .supports(evidenceA.id, supportedClaim.id)
      .supports(evidenceA.id, conflictedClaim.id)
      .refutes(evidenceB.id, conflictedClaim.id)
      .conflictsWith(challenge.id, conflictedClaim.id)
      .qualifies(conflictedClaim.id, verdict.id)
      .build();

    const summary = summarizeClaimGraphQuality(graph);

    expect(summary.nodeCount).toBe(6);
    expect(summary.edgeCount).toBe(5);
    expect(summary.supportCount).toBe(2);
    expect(summary.refuteCount).toBe(1);
    expect(summary.conflictCount).toBe(1);
    expect(summary.conflictedClaimCount).toBe(1);
    expect(summary.coverage).toMatchObject({
      claimCount: 2,
      evidenceCount: 2,
      claimsWithEvidence: 2,
      evidenceCoverage: 1,
      claimsWithVerdict: 1,
      verdictCoverage: 0.5,
      challengedClaims: 1,
      challengeCoverage: 0.5,
    });
    expect(summary.orphanEdgeCount).toBe(0);
  });
});
