export type ClaimGraphNodeType =
  | 'user_claim'
  | 'model_claim'
  | 'evidence'
  | 'challenge'
  | 'verdict';

export type ClaimGraphEdgeRelation =
  | 'supports'
  | 'refutes'
  | 'qualifies'
  | 'depends_on'
  | 'conflicts_with';

export type ClaimGraphMetadata = Record<string, unknown>;

export interface ClaimGraphNode {
  id: string;
  type: ClaimGraphNodeType;
  label: string;
  text?: string;
  ref?: string;
  metadata: ClaimGraphMetadata;
}

export interface ClaimGraphEdge {
  id: string;
  from: string;
  to: string;
  relation: ClaimGraphEdgeRelation;
  strength: number;
  source?: string;
  rationale?: string;
  metadata: ClaimGraphMetadata;
}

export interface ClaimGraph {
  nodes: ClaimGraphNode[];
  edges: ClaimGraphEdge[];
}

export interface BaseClaimGraphNodeInput {
  id: string;
  label?: string;
  text?: string;
  ref?: string;
  metadata?: ClaimGraphMetadata;
}

export interface UserClaimNodeInput extends BaseClaimGraphNodeInput {
  claimantId?: string;
}

export interface ModelClaimNodeInput extends BaseClaimGraphNodeInput {
  modelId: string;
  stage?: string;
  confidence?: number;
}

export interface EvidenceNodeInput extends BaseClaimGraphNodeInput {
  title?: string;
  url?: string;
  summary?: string;
  reliability?: number;
}

export interface ChallengeNodeInput extends BaseClaimGraphNodeInput {
  challengerId?: string;
  targetId?: string;
  severity?: 'low' | 'medium' | 'high' | string;
}

export interface VerdictNodeInput extends BaseClaimGraphNodeInput {
  status: string;
  confidence?: number;
  reviewer?: string;
}

export interface ClaimGraphEdgeInput {
  id?: string;
  from: string;
  to: string;
  relation: ClaimGraphEdgeRelation;
  strength?: number;
  source?: string;
  rationale?: string;
  metadata?: ClaimGraphMetadata;
}

export interface ClaimGraphRelationOptions {
  id?: string;
  strength?: number;
  source?: string;
  rationale?: string;
  metadata?: ClaimGraphMetadata;
}

export interface TraceClaimGraphPathsOptions {
  from: string;
  to: string;
  maxDepth?: number;
  relations?: ClaimGraphEdgeRelation[];
}

export interface ClaimGraphPath {
  nodes: ClaimGraphNode[];
  edges: ClaimGraphEdge[];
  relations: ClaimGraphEdgeRelation[];
  strength: number;
}

export interface ClaimGraphEvidenceChain {
  evidence: ClaimGraphNode;
  target: ClaimGraphNode;
  path: ClaimGraphPath;
  relations: ClaimGraphEdgeRelation[];
  strength: number;
}

export interface ClaimGraphQualitySummary {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<ClaimGraphNodeType, number>;
  edgesByRelation: Record<ClaimGraphEdgeRelation, number>;
  supportCount: number;
  refuteCount: number;
  qualifyCount: number;
  dependencyCount: number;
  conflictCount: number;
  orphanEdgeCount: number;
  conflictedClaimCount: number;
  coverage: {
    claimCount: number;
    evidenceCount: number;
    claimsWithEvidence: number;
    evidenceCoverage: number;
    claimsWithVerdict: number;
    verdictCoverage: number;
    challengedClaims: number;
    challengeCoverage: number;
  };
}

export function createUserClaimNode(input: UserClaimNodeInput): ClaimGraphNode {
  return createClaimGraphNode({
    ...input,
    id: nodeId('user_claim', input.id),
    type: 'user_claim',
    label: input.label ?? input.text ?? input.id,
    metadata: withDefinedMetadata(input.metadata, {
      claimantId: input.claimantId,
    }),
  });
}

export function createModelClaimNode(input: ModelClaimNodeInput): ClaimGraphNode {
  return createClaimGraphNode({
    ...input,
    id: nodeId('model_claim', input.id),
    type: 'model_claim',
    label: input.label ?? `${input.modelId} claim`,
    metadata: withDefinedMetadata(input.metadata, {
      modelId: input.modelId,
      stage: input.stage,
      confidence: input.confidence,
    }),
  });
}

export function createEvidenceNode(input: EvidenceNodeInput): ClaimGraphNode {
  return createClaimGraphNode({
    ...input,
    id: nodeId('evidence', input.id),
    type: 'evidence',
    label: input.label ?? input.title ?? input.url ?? input.id,
    text: input.text ?? input.summary,
    ref: input.ref ?? input.url,
    metadata: withDefinedMetadata(input.metadata, {
      title: input.title,
      url: input.url,
      reliability: input.reliability,
    }),
  });
}

export function createChallengeNode(input: ChallengeNodeInput): ClaimGraphNode {
  return createClaimGraphNode({
    ...input,
    id: nodeId('challenge', input.id),
    type: 'challenge',
    label: input.label ?? input.text ?? `Challenge ${input.id}`,
    metadata: withDefinedMetadata(input.metadata, {
      challengerId: input.challengerId,
      targetId: input.targetId,
      severity: input.severity,
    }),
  });
}

export function createVerdictNode(input: VerdictNodeInput): ClaimGraphNode {
  return createClaimGraphNode({
    ...input,
    id: nodeId('verdict', input.id),
    type: 'verdict',
    label: input.label ?? `${input.status} verdict`,
    metadata: withDefinedMetadata(input.metadata, {
      status: input.status,
      confidence: input.confidence,
      reviewer: input.reviewer,
    }),
  });
}

export function createClaimGraphEdge(input: ClaimGraphEdgeInput): ClaimGraphEdge {
  assertNonEmpty(input.from, 'edge.from');
  assertNonEmpty(input.to, 'edge.to');

  const strength = input.strength ?? 1;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new RangeError('edge.strength must be a finite number between 0 and 1');
  }

  return {
    id: input.id ?? edgeId(input.from, input.to, input.relation, input.source),
    from: input.from,
    to: input.to,
    relation: input.relation,
    strength,
    source: input.source,
    rationale: input.rationale,
    metadata: input.metadata ?? {},
  };
}

export class ClaimGraphBuilder {
  private readonly nodes = new Map<string, ClaimGraphNode>();
  private readonly edges = new Map<string, ClaimGraphEdge>();

  constructor(seed?: Partial<ClaimGraph>) {
    for (const node of seed?.nodes ?? []) {
      this.addNode(node);
    }
    for (const edge of seed?.edges ?? []) {
      this.addEdge(edge);
    }
  }

  addNode(node: ClaimGraphNode): this {
    assertNonEmpty(node.id, 'node.id');
    this.nodes.set(node.id, { ...node, metadata: node.metadata ?? {} });
    return this;
  }

  addNodes(nodes: ClaimGraphNode[]): this {
    for (const node of nodes) {
      this.addNode(node);
    }
    return this;
  }

  addEdge(input: ClaimGraphEdgeInput | ClaimGraphEdge): this {
    const edge = createClaimGraphEdge(input);
    if (!this.nodes.has(edge.from)) {
      throw new Error(`Cannot add edge from unknown node: ${edge.from}`);
    }
    if (!this.nodes.has(edge.to)) {
      throw new Error(`Cannot add edge to unknown node: ${edge.to}`);
    }
    this.edges.set(edge.id, edge);
    return this;
  }

  supports(from: string, to: string, options: ClaimGraphRelationOptions = {}): this {
    return this.addRelation(from, to, 'supports', options);
  }

  refutes(from: string, to: string, options: ClaimGraphRelationOptions = {}): this {
    return this.addRelation(from, to, 'refutes', options);
  }

  qualifies(from: string, to: string, options: ClaimGraphRelationOptions = {}): this {
    return this.addRelation(from, to, 'qualifies', options);
  }

  dependsOn(from: string, to: string, options: ClaimGraphRelationOptions = {}): this {
    return this.addRelation(from, to, 'depends_on', options);
  }

  conflictsWith(from: string, to: string, options: ClaimGraphRelationOptions = {}): this {
    return this.addRelation(from, to, 'conflicts_with', options);
  }

  build(): ClaimGraph {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }

  private addRelation(
    from: string,
    to: string,
    relation: ClaimGraphEdgeRelation,
    options: ClaimGraphRelationOptions
  ): this {
    return this.addEdge({ ...options, from, to, relation });
  }
}

export function traceClaimGraphPaths(
  graph: ClaimGraph,
  options: TraceClaimGraphPathsOptions
): ClaimGraphPath[] {
  const nodeById = indexNodes(graph);
  if (!nodeById.has(options.from) || !nodeById.has(options.to)) return [];

  const maxDepth = options.maxDepth ?? 6;
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError('maxDepth must be a non-negative integer');
  }

  const relationFilter = options.relations ? new Set(options.relations) : undefined;
  const edgesByFrom = indexEdgesByFrom(graph, relationFilter);
  const paths: ClaimGraphPath[] = [];

  const visit = (
    currentId: string,
    visited: Set<string>,
    pathEdges: ClaimGraphEdge[]
  ): void => {
    if (currentId === options.to) {
      paths.push(toClaimGraphPath(nodeById, options.from, pathEdges));
      return;
    }

    if (pathEdges.length >= maxDepth) return;

    for (const edge of edgesByFrom.get(currentId) ?? []) {
      if (!nodeById.has(edge.to)) continue;
      if (visited.has(edge.to)) continue;

      const nextVisited = new Set(visited);
      nextVisited.add(edge.to);
      visit(edge.to, nextVisited, [...pathEdges, edge]);
    }
  };

  visit(options.from, new Set([options.from]), []);
  return paths.sort(comparePaths);
}

export function extractEvidenceChains(
  graph: ClaimGraph,
  targetNodeId: string,
  options: Omit<Partial<TraceClaimGraphPathsOptions>, 'from' | 'to'> = {}
): ClaimGraphEvidenceChain[] {
  const nodeById = indexNodes(graph);
  const target = nodeById.get(targetNodeId);
  if (!target) return [];

  const evidenceNodes = graph.nodes.filter(node => node.type === 'evidence');
  const chains = evidenceNodes.flatMap(evidence => {
    const paths = traceClaimGraphPaths(graph, {
      from: evidence.id,
      to: targetNodeId,
      maxDepth: options.maxDepth,
      relations: options.relations,
    });

    return paths.map(path => ({
      evidence,
      target,
      path,
      relations: path.relations,
      strength: path.strength,
    }));
  });

  return chains.sort((a, b) => comparePaths(a.path, b.path));
}

export function summarizeClaimGraphQuality(graph: ClaimGraph): ClaimGraphQualitySummary {
  const nodeById = indexNodes(graph);
  const claimNodes = graph.nodes.filter(isClaimNode);
  const evidenceNodes = graph.nodes.filter(node => node.type === 'evidence');
  const verdictNodes = graph.nodes.filter(node => node.type === 'verdict');
  const challengeNodes = graph.nodes.filter(node => node.type === 'challenge');
  const nodesByType = emptyNodeCounts();
  const edgesByRelation = emptyRelationCounts();

  for (const node of graph.nodes) {
    nodesByType[node.type] += 1;
  }
  for (const edge of graph.edges) {
    edgesByRelation[edge.relation] += 1;
  }

  const orphanEdgeCount = graph.edges.filter(
    edge => !nodeById.has(edge.from) || !nodeById.has(edge.to)
  ).length;
  const claimIds = new Set(claimNodes.map(node => node.id));
  const verdictIds = new Set(verdictNodes.map(node => node.id));
  const challengeIds = new Set(challengeNodes.map(node => node.id));
  const claimsWithEvidence = claimNodes.filter(
    claim => extractEvidenceChains(graph, claim.id, { maxDepth: 4 }).length > 0
  ).length;
  const claimsWithVerdict = countClaimsAdjacentTo(claimIds, verdictIds, graph.edges);
  const challengedClaims = countClaimsAdjacentTo(claimIds, challengeIds, graph.edges);
  const conflictedClaimCount = countConflictedClaims(claimIds, graph.edges);
  const claimCount = claimNodes.length;

  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodesByType,
    edgesByRelation,
    supportCount: edgesByRelation.supports,
    refuteCount: edgesByRelation.refutes,
    qualifyCount: edgesByRelation.qualifies,
    dependencyCount: edgesByRelation.depends_on,
    conflictCount: edgesByRelation.conflicts_with,
    orphanEdgeCount,
    conflictedClaimCount,
    coverage: {
      claimCount,
      evidenceCount: evidenceNodes.length,
      claimsWithEvidence,
      evidenceCoverage: ratio(claimsWithEvidence, claimCount),
      claimsWithVerdict,
      verdictCoverage: ratio(claimsWithVerdict, claimCount),
      challengedClaims,
      challengeCoverage: ratio(challengedClaims, claimCount),
    },
  };
}

export function claimGraphNodeId(type: ClaimGraphNodeType, id: string): string {
  return nodeId(type, id);
}

function createClaimGraphNode(
  input: BaseClaimGraphNodeInput & { type: ClaimGraphNodeType }
): ClaimGraphNode {
  assertNonEmpty(input.id, 'node.id');
  assertNonEmpty(input.label, 'node.label');
  const label = input.label;
  if (!label) {
    throw new Error('node.label must be a non-empty string');
  }
  return {
    id: input.id,
    type: input.type,
    label,
    text: input.text,
    ref: input.ref,
    metadata: input.metadata ?? {},
  };
}

function nodeId(type: ClaimGraphNodeType, id: string): string {
  assertNonEmpty(id, 'node input id');
  return `${type}:${id}`;
}

function edgeId(
  from: string,
  to: string,
  relation: ClaimGraphEdgeRelation,
  source?: string
): string {
  return `${from}|${relation}|${to}|${source ?? 'unsourced'}`;
}

function withDefinedMetadata(
  metadata: ClaimGraphMetadata | undefined,
  values: ClaimGraphMetadata
): ClaimGraphMetadata {
  const result: ClaimGraphMetadata = { ...(metadata ?? {}) };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function assertNonEmpty(value: string | undefined, name: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function indexNodes(graph: ClaimGraph): Map<string, ClaimGraphNode> {
  return new Map(graph.nodes.map(node => [node.id, node]));
}

function indexEdgesByFrom(
  graph: ClaimGraph,
  relations?: Set<ClaimGraphEdgeRelation>
): Map<string, ClaimGraphEdge[]> {
  const edgesByFrom = new Map<string, ClaimGraphEdge[]>();
  for (const edge of graph.edges) {
    if (relations && !relations.has(edge.relation)) continue;
    const bucket = edgesByFrom.get(edge.from) ?? [];
    bucket.push(edge);
    edgesByFrom.set(edge.from, bucket);
  }
  return edgesByFrom;
}

function toClaimGraphPath(
  nodeById: Map<string, ClaimGraphNode>,
  startId: string,
  edges: ClaimGraphEdge[]
): ClaimGraphPath {
  const nodes = [nodeById.get(startId), ...edges.map(edge => nodeById.get(edge.to))].filter(
    (node): node is ClaimGraphNode => node !== undefined
  );
  return {
    nodes,
    edges,
    relations: edges.map(edge => edge.relation),
    strength: edges.length === 0 ? 1 : Math.min(...edges.map(edge => edge.strength)),
  };
}

function comparePaths(a: ClaimGraphPath, b: ClaimGraphPath): number {
  if (a.edges.length !== b.edges.length) {
    return a.edges.length - b.edges.length;
  }
  return a.nodes.map(node => node.id).join('|').localeCompare(b.nodes.map(node => node.id).join('|'));
}

function emptyNodeCounts(): Record<ClaimGraphNodeType, number> {
  return {
    user_claim: 0,
    model_claim: 0,
    evidence: 0,
    challenge: 0,
    verdict: 0,
  };
}

function emptyRelationCounts(): Record<ClaimGraphEdgeRelation, number> {
  return {
    supports: 0,
    refutes: 0,
    qualifies: 0,
    depends_on: 0,
    conflicts_with: 0,
  };
}

function isClaimNode(node: ClaimGraphNode): boolean {
  return node.type === 'user_claim' || node.type === 'model_claim';
}

function countClaimsAdjacentTo(
  claimIds: Set<string>,
  otherIds: Set<string>,
  edges: ClaimGraphEdge[]
): number {
  const covered = new Set<string>();
  for (const edge of edges) {
    if (claimIds.has(edge.from) && otherIds.has(edge.to)) {
      covered.add(edge.from);
    }
    if (claimIds.has(edge.to) && otherIds.has(edge.from)) {
      covered.add(edge.to);
    }
  }
  return covered.size;
}

function countConflictedClaims(claimIds: Set<string>, edges: ClaimGraphEdge[]): number {
  const relationsByClaim = new Map<string, Set<ClaimGraphEdgeRelation>>();
  for (const edge of edges) {
    if (claimIds.has(edge.to)) {
      const relations = relationsByClaim.get(edge.to) ?? new Set<ClaimGraphEdgeRelation>();
      relations.add(edge.relation);
      relationsByClaim.set(edge.to, relations);
    }
    if (edge.relation === 'conflicts_with' && claimIds.has(edge.from)) {
      const relations = relationsByClaim.get(edge.from) ?? new Set<ClaimGraphEdgeRelation>();
      relations.add(edge.relation);
      relationsByClaim.set(edge.from, relations);
    }
  }

  let count = 0;
  for (const [claimId, relations] of relationsByClaim.entries()) {
    if (!claimIds.has(claimId)) continue;
    if (
      relations.has('conflicts_with') ||
      (relations.has('supports') && relations.has('refutes'))
    ) {
      count += 1;
    }
  }
  return count;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
