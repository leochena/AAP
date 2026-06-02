/**
 * AI对抗协议 - 类型定义（重构后）
 * AI Adversarial Protocol - Type Definitions
 */

// ========== 模型配置 ==========

export type ModelProtocol = 'openai' | 'anthropic' | 'ollama';

/**
 * 单个模型的配置。一个 endpoint 可以提供多个模型，
 * 每个模型一条 ModelConfig 记录。
 */
export interface ModelConfig {
  id: string;              // 用户指定的别名，全局唯一
  protocol: ModelProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;           // 上游真实模型名
  weight?: number;         // 投票权重，默认 1.0
  enabled: boolean;
  /**
   * tool-calling 能力声明：
   *   - 'auto'（默认）：由 capability-probe 决定
   *   - 'yes' / 'no'：用户强制覆盖
   * 当 run 启用 tools 时，'no' 的模型会被剔除。
   */
  toolCallingSupport?: 'yes' | 'no' | 'auto';
}

// ========== 应用配置 ==========

export interface AdversarialConfig {
  autoChallenge: {
    enabled: boolean;
    threshold: number;       // 置信度阈值（0-1）
    maxChallengesPerRound: number;
  };
  voting: {
    enabled: boolean;
    mode: 'majority' | 'weighted' | 'consensus' | 'unanimous';
    threshold: number;
    tiebreaker: 'first' | 'random' | 'abstain';
  };
  /**
   * 每个 run 中各模型回答的轮数（≥1）。
   *   round 1: 各模型独立作答；
   *   round n>1: 在 prompt 中追加上一轮全部回答 + 挑刺，让模型基于上下文修正。
   * 投票仅基于最终轮回答。
   */
  maxRounds: number;

  /**
   * 自适应轮次控制。maxRounds 是安全上限，不是“求真完成”的信号。
   * 引擎至少运行 minRounds；之后若仍有中/高严重性挑刺或黑板要求强制修正，
   * 会继续到 maxRounds。到上限仍有冲突时，最终契约必须标记需复核。
   */
  roundControl?: {
    minRounds: number;
    continueOnHighSeverityChallenge: boolean;
    continueOnMediumSeverityChallenge: boolean;
    continueOnRequiredRevision: boolean;
  };

  /**
   * 工具调用 / 求真接地配置。tools.enabled 为 false 时，引擎走纯文本路径
   * （和 Tier 1/2 行为完全一样）。
   */
  tools: {
    enabled: boolean;
    searxngUrl: string;          // SearXNG 端点，例：http://127.0.0.1:28080
    searchEngines: string;        // 默认 "bing"
    fetchUrl: { enabled: boolean; maxBytes: number; timeoutMs: number };
    codeExec: {
      enabled: boolean;
      image: string;
      timeoutMs: number;
      memoryMb: number;
      cpus: string;
      wslDistro?: string;
    };
    /**
     * Local repository audit tools. These are read-only by default and may only
     * access explicitly configured roots. Tool results are sent to the selected
     * model providers, so roots should point at repositories the operator is
     * willing to expose in bounded snippets.
     */
    localRepo?: {
      enabled: boolean;
      roots: string[];
      maxFiles: number;
      maxFileBytes: number;
      maxReadBytes: number;
      maxSearchResults: number;
      allowCommands: boolean;
      allowedCommands: string[];
      commandTimeoutMs: number;
    };
    concede: { enabled: boolean };
    maxToolCallsPerGeneration: number;
    capabilityCacheHours: number;
  };
}

export interface ServerConfig {
  port: number;
  host: string;
}

export interface AppConfig {
  models: ModelConfig[];
  server: ServerConfig;
  adversarial: AdversarialConfig;
  storageDir: string;        // 默认 ~/.aap
}

// ========== 消息（最小化，无UI字段）==========

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ========== 单个模型的回答 ==========

export interface ModelResponse {
  modelId: string;             // ModelConfig.id
  content: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  error?: string;
  thinkingBlocks?: ThinkingBlock[];
  /** 模型在生成阶段调用的工具列表（仅 OpenAI tool-calling 通路填充） */
  toolCalls?: Array<{ name: string; ok: boolean }>;
  /** 模型本轮是否主动认错退出（concede 工具） */
  withdrawn?: boolean;
  withdrawnReason?: string;
  withdrawnDeferTo?: string;
}

// ========== 思维过程 ==========

export interface ThinkingBlock {
  modelId: string;
  content: string;
  order: number;
  source: 'explicit-tag' | 'extended-thinking' | 'o1-reasoning';
}

// ========== 互相挑刺 ==========

export type ChallengeType =
  | 'factual-error'
  | 'logical-flaw'
  | 'omission'
  | 'unclear'
  | 'other';

export type ChallengeSeverity = 'low' | 'medium' | 'high';
export type ChallengeStatus = 'pending' | 'accepted' | 'rejected' | 'debated';

export interface Challenge {
  id: string;
  challengerId: string;        // 发起挑刺的 ModelConfig.id
  targetId: string;            // 被挑刺的 ModelConfig.id
  type: ChallengeType;
  severity: ChallengeSeverity;
  targetSegment: string;       // 被挑刺的具体文本片段
  reason: string;              // 挑刺原因
  confidence: number;          // 0-1
  status: ChallengeStatus;
  timestamp: number;
}

// ========== 投票 ==========

export interface Vote {
  voterId: string;             // 投票模型 ModelConfig.id
  choice: string;              // 选择的 modelId
  confidence: number;
  reasoning?: string;
  timestamp: number;
}

export interface VotingResult {
  votes: Vote[];
  totals: Record<string, number>;     // modelId → 加权总分
  winner?: string;                    // modelId
  consensusLevel: number;             // 0-1
  isTie: boolean;
  isUnanimous: boolean;
  requiresReview: boolean;
}

// ========== 用户意见参与 ==========

export interface UserOpinionInput {
  text: string;
  evidenceUrls?: string[];
}

export type UserClaimType = 'fact' | 'preference' | 'hypothesis' | 'evidence';

export interface UserClaim {
  id: string;
  text: string;
  type: UserClaimType;
  evidenceUrls: string[];
}

export type UserClaimAssessmentStance = 'support' | 'refute' | 'mixed' | 'insufficient';

export interface UserClaimAssessment {
  modelId: string;
  claimId: string;
  stance: UserClaimAssessmentStance;
  confidence: number;
  reasoning?: string;
  evidenceUsed: boolean;
}

export type UserClaimVerdictStatus = 'adopted' | 'rejected' | 'partial' | 'unresolved';

export interface UserClaimVerdict {
  claimId: string;
  status: UserClaimVerdictStatus;
  support: number;
  refute: number;
  mixed: number;
  insufficient: number;
  consensus: number;
  reason: string;
}

export interface SycophancySignal {
  modelId: string;
  claimId: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
}

export interface ModelSycophancyScore {
  modelId: string;
  signalCount: number;
  maxSeverity: 'none' | 'low' | 'medium' | 'high';
  /** Multiplier applied to this model's vote weight for the current run. */
  penaltyMultiplier: number;
  reason: string;
}

export interface EvidenceFetchResult {
  url: string;
  status: 'fetched' | 'failed' | 'skipped';
  ok: boolean;
  statusCode?: number;
  title?: string;
  contentType?: string;
  preview?: string;
  error?: string;
}

export type DebateGraphNodeType =
  | 'user_claim'
  | 'model_answer'
  | 'evidence'
  | 'challenge'
  | 'verdict';

export interface DebateGraphNode {
  id: string;
  type: DebateGraphNodeType;
  label: string;
  refId?: string;
  meta?: Record<string, unknown>;
}

export type DebateGraphEdgeRelation =
  | 'supports'
  | 'refutes'
  | 'qualifies'
  | 'depends_on'
  | 'assesses'
  | 'produces';

export interface DebateGraphEdge {
  from: string;
  to: string;
  relation: DebateGraphEdgeRelation;
  strength: number;
  source: string;
}

export interface DebateGraph {
  nodes: DebateGraphNode[];
  edges: DebateGraphEdge[];
}

export interface UserClaimAdoptionRow {
  claimId: string;
  claimText: string;
  status: UserClaimVerdictStatus;
  byModel: Record<string, UserClaimAssessmentStance>;
  evidenceStatuses: Array<{ url: string; status: EvidenceFetchResult['status']; ok: boolean }>;
  sycophancyRiskModels: string[];
}

export interface UserOpinionResult {
  input: UserOpinionInput;
  claims: UserClaim[];
  evidenceResults: EvidenceFetchResult[];
  assessments: UserClaimAssessment[];
  verdicts: UserClaimVerdict[];
  sycophancySignals: SycophancySignal[];
  modelSycophancyScores: ModelSycophancyScore[];
  adoptionMatrix: UserClaimAdoptionRow[];
  graph: DebateGraph;
  summary: string;
}

// ========== 结构化黑板 / 圆桌协议 ==========

export type StructuredDeliberationEventAction =
  | 'propose_claim'
  | 'register_evidence'
  | 'register_challenge'
  | 'flag_identity_drift'
  | 'flag_consensus_risk'
  | 'protect_minority'
  | 'request_revision';

export interface StructuredDeliberationEvent {
  id: string;
  round: number;
  actorId: string;
  action: StructuredDeliberationEventAction;
  targetId?: string;
  payload: Record<string, unknown>;
  summary: string;
}

export interface BlackboardClaim {
  id: string;
  round: number;
  modelId: string;
  text: string;
  fingerprint: string;
  confidence: number;
  evidenceRefs: string[];
  uncertainty: boolean;
}

export interface BlackboardEvidenceRef {
  id: string;
  firstSeenRound: number;
  sourceModelId: string;
  url: string;
  host: string;
  claimIds: string[];
}

export interface BlackboardChallengeRef {
  id: string;
  round: number;
  challengeId: string;
  challengerId: string;
  targetId: string;
  type: ChallengeType;
  severity: ChallengeSeverity;
  confidence: number;
  targetSegment: string;
  reason: string;
}

export interface IdentityDriftSignal {
  id: string;
  round: number;
  modelId: string;
  runtimeIdentity: string;
  claimedIdentity: string;
  severity: 'low' | 'medium' | 'high';
  evidenceText: string;
  reason: string;
}

export interface ConsensusRiskSignal {
  id: string;
  round: number;
  clusterId: string;
  modelIds: string[];
  claimIds: string[];
  independentEvidenceCount: number;
  severity: 'low' | 'medium' | 'high';
  reason: string;
}

export interface MinorityProtectionSignal {
  id: string;
  round: number;
  modelId: string;
  claimId: string;
  againstClusterId: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
}

export interface StructuredConsensusCluster {
  id: string;
  modelIds: string[];
  claimIds: string[];
  fingerprint: string;
  independentEvidenceCount: number;
  risk: 'none' | 'low' | 'medium' | 'high';
}

export interface StructuredRevisionDirective {
  id: string;
  round: number;
  modelId: string;
  targetClaimIds: string[];
  source: 'identity-drift' | 'consensus-risk' | 'minority-protection' | 'challenge';
  reason: string;
  required: boolean;
}

export interface StructuredDeliberationRoundSummary {
  round: number;
  claimIds: string[];
  challengeIds: string[];
  consensusRiskIds: string[];
  identityDriftSignalIds: string[];
  minorityProtectionIds: string[];
  revisionDirectiveIds: string[];
  summary: string;
}

export interface StructuredDeliberationResult {
  currentRound: number;
  claims: BlackboardClaim[];
  evidenceRefs: BlackboardEvidenceRef[];
  challengeRefs: BlackboardChallengeRef[];
  consensusClusters: StructuredConsensusCluster[];
  identityDriftSignals: IdentityDriftSignal[];
  consensusRisks: ConsensusRiskSignal[];
  minorityProtection: MinorityProtectionSignal[];
  revisionDirectives: StructuredRevisionDirective[];
  rounds: StructuredDeliberationRoundSummary[];
  events: StructuredDeliberationEvent[];
  reviewReasons: string[];
  summary: string;
}

// ========== 协议级裁决输出契约 ==========

export interface ProtocolEvidenceChainItem {
  id: string;
  source: string;
  summary: string;
  status: 'supporting' | 'refuting' | 'qualifying' | 'unverified';
  url?: string;
  confidence: number;
}

export interface ProtocolConflictPoint {
  id: string;
  source: string;
  summary: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ProtocolUserClaimDecision {
  claimId: string;
  claimText: string;
  decision: UserClaimVerdictStatus;
  reason: string;
}

export interface ProtocolSycophancyRisk {
  modelId: string;
  claimId?: string;
  severity: 'low' | 'medium' | 'high';
  penaltyMultiplier?: number;
  reason: string;
}

export interface ProtocolReviewState {
  required: boolean;
  reasons: string[];
}

export interface ProtocolOutputContract {
  conclusion: string;
  confidence: number;
  evidenceChain: ProtocolEvidenceChainItem[];
  conflictPoints: ProtocolConflictPoint[];
  userClaims: ProtocolUserClaimDecision[];
  sycophancyRisks: ProtocolSycophancyRisk[];
  review: ProtocolReviewState;
}

// ========== 审计评分 ==========

export interface AuditMetrics {
  modelId: string;
  totalMessages: number;
  totalChallenges: number;
  challengesByType: Record<ChallengeType, number>;
  challengesBySeverity: Record<ChallengeSeverity, number>;
  acceptedChallenges: number;
  rejectedChallenges: number;
  reliabilityScore: number;     // 0-100，-1 = 数据不足
  lastUpdated: number;
}

export interface AuditState {
  metrics: Record<string, AuditMetrics>;
}

// ========== 对抗运行 ==========

export type RunSource = 'tui-input' | 'http-openai' | 'http-anthropic';

export type RunPhase =
  | 'pending'
  | 'generating'
  | 'deliberation'
  | 'user-opinion'
  | 'auto-challenge'
  | 'voting'
  | 'complete'
  | 'failed';

export interface RunRequest {
  question: string;
  history?: Message[];           // 之前的对话历史
  modelIds: string[];            // 参与的模型 ID
  source: RunSource;
  enableAutoChallenge?: boolean; // 覆盖默认配置
  enableVoting?: boolean;
  maxRounds?: number;            // 覆盖默认 maxRounds
  /** 覆盖 adversarial.tools.enabled —— 让单次 run 临时开/关工具 */
  useTools?: boolean;
  /**
   * 用户意见作为待验证 claim 参与对抗。它不会直接获得投票权；
   * 引擎会先完成盲审式模型回答，再让模型评审这些 claim。
   */
  userOpinion?: UserOpinionInput;
}

export interface RunSnapshot {
  runId: string;
  source: RunSource;
  request: RunRequest;
  phase: RunPhase;
  responses: Record<string, ModelResponse>;  // modelId → 最终轮 response
  challenges: Challenge[];                    // 最终轮的挑刺
  structuredDeliberation?: StructuredDeliberationResult;
  voting?: VotingResult;
  userOpinion?: UserOpinionResult;
  protocolOutput?: ProtocolOutputContract;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  currentRound?: number;        // 1-based，仅 multi-round
  totalRounds?: number;
  roundsCompleted?: number;
  roundStopReason?: 'converged' | 'max-rounds' | 'single-round';
  roundStopDetail?: string;
}

export interface RunResult {
  runId: string;
  responses: ModelResponse[];
  challenges: Challenge[];
  structuredDeliberation?: StructuredDeliberationResult;
  voting?: VotingResult;
  userOpinion?: UserOpinionResult;
  protocolOutput?: ProtocolOutputContract;
  metrics: Record<string, AuditMetrics>;
  durationMs: number;
  roundsCompleted?: number;
  roundStopReason?: 'converged' | 'max-rounds' | 'single-round';
  roundStopDetail?: string;
}

// ========== Engine 事件 ==========

export type EngineEventType =
  | 'run-start'
  | 'phase-change'
  | 'round-start'
  | 'chunk'
  | 'model-complete'
  | 'tool-call'
  | 'model-withdrawn'
  | 'deliberation-result'
  | 'challenge'
  | 'user-opinion-result'
  | 'voting-result'
  | 'run-complete'
  | 'run-failed';

export interface EngineEvent {
  runId: string;
  type: EngineEventType;
  timestamp: number;
  data: unknown;
}

export interface ChunkEventData {
  modelId: string;
  delta: string;
  contentSoFar: string;
}

export interface PhaseChangeEventData {
  phase: RunPhase;
}

export interface RoundStartEventData {
  round: number;
  totalRounds: number;
}

export interface ToolCallEventData {
  modelId: string;
  toolName: string;
  ok: boolean;
  /** truncated to ~200 chars to avoid swamping the event bus */
  preview: string;
}

export interface ModelWithdrawnEventData {
  modelId: string;
  reason: string;
  deferTo?: string;
}

export interface ModelCompleteEventData {
  response: ModelResponse;
}

export interface ChallengeEventData {
  challenge: Challenge;
}

export interface StructuredDeliberationEventData {
  result: StructuredDeliberationResult;
}

export interface VoteEventData {
  vote: Vote;
}

export interface VotingResultEventData {
  result: VotingResult;
}

export interface UserOpinionResultEventData {
  result: UserOpinionResult;
}

export interface RunCompleteEventData {
  result: RunResult;
}

export interface RunFailedEventData {
  error: string;
}
