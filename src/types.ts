/**
 * Conway Automaton — Core Type Definitions
 * All shared interfaces and enums for the sovereign AI agent runtime.
 */

// ─── Agent States ───────────────────────────────────────────────────────────

export type AgentState =
  | 'setup'
  | 'waking'
  | 'running'
  | 'sleeping'
  | 'low_compute'
  | 'critical'
  | 'dead';

export type SurvivalTier = 'high' | 'normal' | 'low_compute' | 'critical' | 'dead';

// ─── Inference ──────────────────────────────────────────────────────────────

export type InferenceTaskType =
  | 'reasoning'
  | 'tool_use'
  | 'creative'
  | 'analysis'
  | 'coding'
  | 'general';

export type InferenceProvider = 'openai' | 'anthropic' | 'conway' | 'omni';

export interface ModelPreference {
  model: string;
  provider: InferenceProvider;
  maxTokens?: number;
}

export interface RoutingMatrix {
  [tier: string]: {
    [taskType: string]: ModelPreference[];
  };
}

export interface InferenceRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  taskType?: InferenceTaskType;
  abortSignal?: AbortSignal;
}

export interface InferenceResponse {
  content: string;
  toolCalls: ToolCall[];
  model: string;
  provider: InferenceProvider;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: number;
  latencyMs: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

// ─── Tool System ────────────────────────────────────────────────────────────

export type ToolRiskLevel = 'safe' | 'caution' | 'dangerous' | 'forbidden';

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  riskLevel: ToolRiskLevel;
  parameters: ToolParameter[];
  handler: ToolHandler;
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
}

export type ToolHandler = (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;

export interface ToolContext {
  db: AutomatonDatabase;
  config: AutomatonConfig;
  state: RuntimeState;
  conwayClient: ConwayClient;
  inferenceClient: InferenceClient;
  logger: StructuredLogger;
}

export interface ToolResult {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  result: ToolResult;
  riskLevel: ToolRiskLevel;
  policyDecision: PolicyDecision;
  durationMs: number;
}

// ─── Policy Engine ──────────────────────────────────────────────────────────

export type PolicyAction = 'allow' | 'deny';

export type InputSource = 'creator' | 'self' | 'peer' | 'external' | 'heartbeat';

export interface PolicyDecision {
  action: PolicyAction;
  reason: string;
  rule: string;
  category: string;
  priority: number;
}

export interface PolicyRule {
  name: string;
  category: string;
  priority: number;
  evaluate(context: PolicyContext): PolicyDecision | null;
}

export interface PolicyContext {
  toolName: string;
  toolRisk: ToolRiskLevel;
  params: Record<string, unknown>;
  inputSource: InputSource;
  state: RuntimeState;
  turnNumber: number;
  sessionTurnCount: number;
  config: AutomatonConfig;
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface AutomatonConfig {
  name: string;
  genesisPrompt: string;
  creatorMessage?: string;
  creatorAddress: string;
  sandboxId: string;
  conwayApiUrl: string;
  conwayApiKey: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  openaiBaseUrl?: string;
  omniApiKey?: string;
  omniBaseUrl?: string;
  inferenceModel: string;
  fallbackModel?: string;
  fallbackProvider?: InferenceProvider;
  fallbackBaseUrl?: string;
  maxTokensPerTurn: number;
  heartbeatConfigPath: string;
  dbPath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  walletAddress: string;
  version: string;
  skillsDir: string;
  maxChildren: number;
  parentAddress?: string;
  socialRelayUrl?: string;
  treasuryPolicy: TreasuryPolicy;
  soulConfig: SoulConfig;
  modelStrategy: ModelStrategy;
}

export interface TreasuryPolicy {
  perPaymentCapCents: number;
  hourlyTransferLimitCents: number;
  dailyTransferLimitCents: number;
  minimumReserveCents: number;
  x402DomainAllowlist: string[];
  inferenceDailyBudgetCents: number;
}

export interface SoulConfig {
  reflectionIntervalMs: number;
  alignmentThreshold: number;
  autoUpdateCapabilities: boolean;
  autoUpdateRelationships: boolean;
  autoUpdateFinancialCharacter: boolean;
  maxHistoryEntries: number;
}

export interface ModelStrategy {
  routingMatrix: RoutingMatrix;
  fallbackModels: string[];
  budgetHourlyCents: number;
  budgetDailyCents: number;
}

// ─── Runtime State ──────────────────────────────────────────────────────────

export interface RuntimeState {
  agentState: AgentState;
  survivalTier: SurvivalTier;
  creditsBalanceCents: number;
  usdcBalanceMicrogons: number;
  turnNumber: number;
  sessionTurnCount: number;
  currentModel: string;
  idleTurnCount: number;
  lastWakeTime: number;
  lastSleepTime: number;
  totalTokensUsed: number;
  totalCostCents: number;
  activeChildren: number;
}

// ─── Database ───────────────────────────────────────────────────────────────

export interface AutomatonDatabase {
  close(): void;
  pragma(pragma: string): unknown;

  // Identity
  getIdentity(key: string): string | undefined;
  setIdentity(key: string, value: string): void;

  // Turns
  insertTurn(turn: TurnRecord): number;
  getTurn(id: number): TurnRecord | undefined;
  getRecentTurns(limit: number): TurnRecord[];

  // Tool calls
  insertToolCall(call: ToolCallRecord): number;
  getToolCallsForTurn(turnId: number): ToolCallRecord[];

  // KV store
  getKV(key: string): string | undefined;
  setKV(key: string, value: string): void;
  deleteKV(key: string): void;

  // Transactions
  insertTransaction(tx: TransactionRecord): number;

  // Skills
  getSkill(name: string): SkillRecord | undefined;
  listSkills(): SkillRecord[];
  upsertSkill(skill: SkillRecord): void;
  deleteSkill(name: string): void;

  // Children
  getChild(id: string): ChildRecord | undefined;
  listChildren(): ChildRecord[];
  upsertChild(child: ChildRecord): void;
  deleteChild(id: string): void;

  // Registry
  getRegistryEntry(key: string): string | undefined;
  setRegistryEntry(key: string, value: string): void;

  // Reputation
  getReputation(agentAddress: string): number;
  setReputation(agentAddress: string, score: number): void;

  // Inbox
  getUnprocessedInboxMessages(): InboxMessageRecord[];
  markInProgress(messageId: string): void;
  markCompleted(messageId: string): void;
  markFailed(messageId: string): void;
  insertInboxMessage(msg: InboxMessageRecord): void;

  // Policy decisions
  insertPolicyDecision(decision: PolicyDecisionRecord): void;

  // Spend tracking
  insertSpendRecord(record: SpendRecord): void;
  getSpendTotal(category: string, windowMs: number): number;

  // Heartbeat
  getHeartbeatSchedule(): HeartbeatScheduleEntry[];
  upsertHeartbeatSchedule(entry: HeartbeatScheduleEntry): void;
  insertHeartbeatHistory(entry: HeartbeatHistoryRecord): void;
  acquireLease(taskId: string, ttlMs: number): boolean;
  releaseLease(taskId: string): void;

  // Wake events
  insertWakeEvent(event: WakeEvent): void;
  consumeWakeEvents(): WakeEvent[];
  hasPendingWakeEvent(): boolean;

  // Heartbeat dedup
  isDedupKeyPresent(key: string): boolean;
  setDedupKey(key: string, ttlMs: number): void;

  // Soul
  getSoulHistory(): SoulHistoryRecord[];
  insertSoulHistory(record: SoulHistoryRecord): void;

  // Working memory
  getWorkingMemory(): WorkingMemoryRecord[];
  insertWorkingMemory(record: WorkingMemoryRecord): void;
  clearWorkingMemory(): void;

  // Episodic memory
  getEpisodicMemory(limit?: number): EpisodicMemoryRecord[];
  insertEpisodicMemory(record: EpisodicMemoryRecord): void;

  // Semantic memory
  getSemanticMemory(category?: string): SemanticMemoryRecord[];
  insertSemanticMemory(record: SemanticMemoryRecord): void;
  deleteSemanticMemory(category: string, key: string): void;

  // Procedural memory
  getProceduralMemory(): ProceduralMemoryRecord[];
  insertProceduralMemory(record: ProceduralMemoryRecord): void;

  // Relationship memory
  getRelationshipMemory(entityId: string): RelationshipMemoryRecord | undefined;
  upsertRelationshipMemory(record: RelationshipMemoryRecord): void;

  // Inference costs
  insertInferenceCost(record: InferenceCostRecord): void;
  getInferenceCostTotal(windowMs: number): number;

  // Model registry
  getModelRegistry(): ModelRegistryEntry[];
  upsertModelRegistry(entry: ModelRegistryEntry): void;

  // Child lifecycle
  insertChildLifecycleEvent(event: ChildLifecycleEvent): void;

  // Discovered agents
  getDiscoveredAgent(address: string): DiscoveredAgentCache | undefined;
  setDiscoveredAgent(agent: DiscoveredAgentCache): void;

  // On-chain transactions
  insertOnchainTransaction(tx: OnchainTransactionRecord): void;

  // Modifications
  insertModification(mod: ModificationRecord): void;

  // Metric snapshots
  insertMetricSnapshot(snapshot: MetricSnapshotRecord): void;

  // Session summaries
  insertSessionSummary(summary: SessionSummaryRecord): void;
}

// ─── Record Types ───────────────────────────────────────────────────────────

export interface TurnRecord {
  id?: number;
  timestamp: number;
  state: AgentState;
  thinking: string;
  toolCalls: string; // JSON
  response: string;
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  model: string;
  inputSource: InputSource;
  inboxMessageId?: string;
}

export interface ToolCallRecord {
  id?: number;
  turnId: number;
  name: string;
  arguments: string; // JSON
  result: string; // JSON
  riskLevel: ToolRiskLevel;
  allowed: boolean;
  durationMs: number;
}

export interface TransactionRecord {
  id?: number;
  timestamp: number;
  type: 'credit_buy' | 'credit_transfer' | 'inference' | 'sandbox' | 'domain';
  amountCents: number;
  description: string;
  txHash?: string;
}

export interface SkillRecord {
  name: string;
  description: string;
  triggers: string[]; // JSON array
  content: string;
  version: number;
  installedAt: number;
  source?: string;
}

export interface ChildRecord {
  id: string;
  name: string;
  parentAddress: string;
  sandboxId: string;
  walletAddress: string;
  state: string;
  createdAt: number;
  lastHealthCheck?: number;
  constitutionHash?: string;
  genesisConfig: string; // JSON
}

export interface InboxMessageRecord {
  id: string;
  from: string;
  fromName?: string;
  content: string;
  signature: string;
  timestamp: number;
  state: 'received' | 'in_progress' | 'completed' | 'failed';
  retryCount: number;
}

export interface PolicyDecisionRecord {
  timestamp: number;
  toolName: string;
  action: PolicyAction;
  reason: string;
  rule: string;
  category: string;
  inputSource: InputSource;
  params: string; // JSON
}

export interface SpendRecord {
  timestamp: number;
  category: string;
  amountCents: number;
  description: string;
}

export interface HeartbeatScheduleEntry {
  taskId: string;
  schedule: string; // cron expression
  enabled: boolean;
  minTier: SurvivalTier;
  leaseTtlMs: number;
  config: string; // JSON
}

export interface HeartbeatHistoryRecord {
  taskId: string;
  timestamp: number;
  success: boolean;
  result: string;
  durationMs: number;
  shouldWake: boolean;
}

export interface WakeEvent {
  id?: number;
  source: string;
  reason: string;
  timestamp: number;
  consumed: boolean;
}

export interface SoulHistoryRecord {
  id?: number;
  timestamp: number;
  content: string;
  contentHash: string;
  alignmentScore?: number;
  autoUpdated: boolean;
}

export interface WorkingMemoryRecord {
  id?: number;
  key: string;
  value: string;
  category: string;
  createdAt: number;
  expiresAt?: number;
}

export interface EpisodicMemoryRecord {
  id?: number;
  timestamp: number;
  event: string;
  classification: string;
  importance: number;
  turnId?: number;
  metadata: string; // JSON
}

export interface SemanticMemoryRecord {
  id?: number;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProceduralMemoryRecord {
  id?: number;
  name: string;
  steps: string;
  successCount: number;
  failCount: number;
  lastUsed: number;
  createdAt: number;
}

export interface RelationshipMemoryRecord {
  entityId: string;
  entityType: string;
  trustScore: number;
  interactionCount: number;
  lastInteraction: number;
  sentiment: number;
  metadata: string; // JSON
}

export interface InferenceCostRecord {
  timestamp: number;
  model: string;
  provider: InferenceProvider;
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  latencyMs: number;
  taskType: string;
}

export interface ModelRegistryEntry {
  model: string;
  provider: InferenceProvider;
  pricingPer1kTokens: number;
  maxContext: number;
  capabilities: string[]; // JSON array
  available: boolean;
  updatedAt: number;
}

export interface ChildLifecycleEvent {
  id?: number;
  childId: string;
  fromState: string;
  toState: string;
  timestamp: number;
  reason: string;
}

export interface DiscoveredAgentCache {
  address: string;
  name: string;
  agentCard: string; // JSON-LD
  capabilities: string[];
  lastSeen: number;
}

export interface OnchainTransactionRecord {
  hash: string;
  from: string;
  to: string;
  value: string;
  chain: string;
  timestamp: number;
  blockNumber: number;
}

export interface ModificationRecord {
  id?: number;
  timestamp: number;
  type: 'file_edit' | 'tool_install' | 'upstream_pull' | 'mcp_install';
  filePath?: string;
  diff?: string;
  hash: string;
  reason: string;
}

export interface MetricSnapshotRecord {
  id?: number;
  timestamp: number;
  counters: string; // JSON
  gauges: string; // JSON
  histograms: string; // JSON
  alerts: string; // JSON array
}

export interface SessionSummaryRecord {
  id?: number;
  sessionStart: number;
  sessionEnd: number;
  turnsCount: number;
  toolsUsed: string; // JSON
  outcome: string;
  totalCostCents: number;
  memoryExtracted: number;
}

// ─── Conway Client ──────────────────────────────────────────────────────────

export interface ConwayClient {
  exec(sandboxId: string, command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  writeFile(sandboxId: string, path: string, content: string): Promise<void>;
  readFile(sandboxId: string, path: string): Promise<string>;
  exposePort(sandboxId: string, port: number): Promise<string>;
  removePort(sandboxId: string, port: number): Promise<void>;
  createSandbox(name: string, config?: Record<string, unknown>): Promise<{ id: string }>;
  deleteSandbox(sandboxId: string): Promise<void>;
  listSandboxes(): Promise<Array<{ id: string; name: string; status: string }>>;
  getCreditsBalance(): Promise<number>;
  getCreditsPricing(): Promise<Record<string, number>>;
  transferCredits(to: string, amountCents: number): Promise<{ txHash: string }>;
  searchDomains(query: string): Promise<Array<{ name: string; available: boolean; priceCents: number }>>;
  registerDomain(name: string): Promise<{ domain: string }>;
  listDnsRecords(domain: string): Promise<Array<{ type: string; name: string; value: string }>>;
  addDnsRecord(domain: string, type: string, name: string, value: string): Promise<void>;
  deleteDnsRecord(domain: string, type: string, name: string, value: string): Promise<void>;
  listModels(): Promise<Array<{ model: string; provider: string; available: boolean }>>;
}

// ─── Inference Client ───────────────────────────────────────────────────────

export interface InferenceClient {
  chatCompletion(request: InferenceRequest): Promise<InferenceResponse>;
  chatCompletionStream(
    request: InferenceRequest,
    onToken: (token: string) => void,
  ): Promise<InferenceResponse>;
}

// ─── Social ─────────────────────────────────────────────────────────────────

export interface SocialMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  signature: string;
  timestamp: number;
  type: 'message' | 'feedback' | 'proposal';
}

export interface AgentCard {
  '@context': string[];
  '@type': string;
  address: string;
  name: string;
  description: string;
  capabilities: string[];
  services: AgentService[];
  contact: { type: string; value: string };
}

export interface AgentService {
  '@type': string;
  name: string;
  description: string;
  endpoint: string;
}

// ─── Soul ───────────────────────────────────────────────────────────────────

export interface SoulData {
  version: string;
  corePurpose: string;
  values: string[];
  personality: string;
  boundaries: string[];
  strategy: string;
  capabilities: string[];
  relationships: SoulRelationship[];
  financialCharacter: string;
}

export interface SoulRelationship {
  entity: string;
  type: string;
  trustLevel: string;
  notes: string;
}

// ─── Skills ─────────────────────────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers: string[];
  version?: string;
}

export interface Skill extends SkillFrontmatter {
  content: string;
  filePath: string;
}

// ─── Heartbeat ──────────────────────────────────────────────────────────────

export interface HeartbeatTask {
  id: string;
  schedule: string;
  minTier: SurvivalTier;
  execute(context: TickContext): Promise<HeartbeatTaskResult>;
}

export interface HeartbeatTaskResult {
  success: boolean;
  message: string;
  shouldWake: boolean;
  metadata?: Record<string, unknown>;
}

export interface TickContext {
  creditsBalance: number;
  usdcBalance: number;
  survivalTier: SurvivalTier;
  config: AutomatonConfig;
  db: AutomatonDatabase;
  conwayClient: ConwayClient;
  inferenceClient: InferenceClient;
  logger: StructuredLogger;
}

export interface HeartbeatConfig {
  tickIntervalMs: number;
  maxConcurrentTasks: number;
  tasks: HeartbeatScheduleEntry[];
}

// ─── Observability ──────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface StructuredLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
  child(module: string): StructuredLogger;
}

export interface MetricsCollector {
  counter(name: string, value?: number, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  snapshot(): MetricSnapshot;
}

export interface MetricSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, number[]>;
}

export interface AlertRule {
  name: string;
  metric: string;
  condition: 'above' | 'below' | 'equals';
  threshold: number;
  severity: 'warning' | 'critical';
  cooldownMs: number;
  wakeOnCritical: boolean;
}

export interface Alert {
  rule: string;
  severity: 'warning' | 'critical';
  message: string;
  timestamp: number;
  metricValue: number;
}

// ─── Replication ────────────────────────────────────────────────────────────

export type ChildState = 'spawning' | 'provisioning' | 'configuring' | 'starting' | 'alive' | 'unhealthy' | 'recovering' | 'dead';

export interface GenesisConfig {
  name: string;
  parentAddress: string;
  genesisPrompt: string;
  constitutionHash: string;
  allowedTools: string[];
  treasuryPolicy: TreasuryPolicy;
}

// ─── Setup ──────────────────────────────────────────────────────────────────

export interface SetupWizardResult {
  config: AutomatonConfig;
  walletKey: string;
}

// ─── Self Modification ─────────────────────────────────────────────────────

export interface SelfModResult {
  success: boolean;
  filePath: string;
  diff: string;
  hash: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const MAX_TOOL_RESULT_SIZE = 8192;
export const MAX_SYSTEM_PROMPT_TOKENS = 16384;
export const MAX_MEMORY_TOKENS = 4096;
export const MAX_CONTEXT_TOKENS = 32768;
export const IDLE_THRESHOLD = 10;  // Stay active longer — critical tier agents need to keep working
export const LOOP_DETECTION_THRESHOLD = 3;
export const DEAD_GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour
export const WAKE_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
export const LEASE_TTL_MS = 60 * 1000; // 60 seconds
export const MAX_CHILDREN_DEFAULT = 3;
export const BOOTSTRAP_TOPUP_CENTS = 500; // $5.00

export const MUTATING_TOOLS = new Set([
  'write_file', 'exec', 'edit_own_file', 'install_npm_package',
  'install_mcp_server', 'pull_upstream', 'topup_credits', 'transfer_credits',
  'x402_fetch', 'install_skill', 'create_skill', 'remove_skill',
  'git_commit', 'git_push', 'spawn_child', 'fund_child',
  'message_child', 'update_soul', 'register_erc8004', 'update_agent_card',
  'modify_heartbeat',
  // Free tools that count as useful work (prevent premature idle sleep)
  'remember_fact', 'send_message', 'review_memory', 'recall_facts',
]);

export const PROTECTED_FILES = [
  'automaton.json',
  'wallet.json',
  'state.db',
  'constitution.md',
  'SOUL.md',
  'api-key',
];

export const SENSITIVE_FILES = [
  'wallet.json',
  'api-key',
  '.env',
  '.env.local',
];

export const DEFAULT_TREASURY_POLICY: TreasuryPolicy = {
  perPaymentCapCents: 10000, // $100
  hourlyTransferLimitCents: 25000, // $250
  dailyTransferLimitCents: 100000, // $1000
  minimumReserveCents: 100, // $1
  x402DomainAllowlist: ['conway.tech'],
  inferenceDailyBudgetCents: 500, // $5
};

export const DEFAULT_SOUL_CONFIG: SoulConfig = {
  reflectionIntervalMs: 4 * 60 * 60 * 1000, // 4 hours
  alignmentThreshold: 0.6,
  autoUpdateCapabilities: true,
  autoUpdateRelationships: true,
  autoUpdateFinancialCharacter: true,
  maxHistoryEntries: 100,
};

export const DEFAULT_ROUTING_MATRIX: RoutingMatrix = {
  high: {
    reasoning: [{ model: 'gpt-5.2', provider: 'openai' }],
    tool_use: [{ model: 'gpt-5.2', provider: 'openai' }],
    creative: [{ model: 'gpt-5.2', provider: 'openai' }],
    analysis: [{ model: 'gpt-5.2', provider: 'openai' }],
    coding: [{ model: 'gpt-5.2', provider: 'openai' }],
    general: [{ model: 'gpt-5.2', provider: 'openai' }],
  },
  normal: {
    reasoning: [{ model: 'gpt-5.2', provider: 'openai' }],
    tool_use: [{ model: 'gpt-5.2', provider: 'openai' }],
    creative: [{ model: 'gpt-5.2', provider: 'openai' }],
    analysis: [{ model: 'gpt-5.2', provider: 'openai' }],
    coding: [{ model: 'gpt-5.2', provider: 'openai' }],
    general: [{ model: 'gpt-5.2', provider: 'openai' }],
  },
  low_compute: {
    reasoning: [{ model: 'gpt-4o-mini', provider: 'openai' }],
    tool_use: [{ model: 'gpt-4o-mini', provider: 'openai' }],
    creative: [{ model: 'gpt-4o-mini', provider: 'openai' }],
    analysis: [{ model: 'gpt-4o-mini', provider: 'openai' }],
    coding: [{ model: 'gpt-4o-mini', provider: 'openai' }],
    general: [{ model: 'gpt-4o-mini', provider: 'openai' }],
  },
  critical: {
    reasoning: [{ model: 'gpt-4o-mini', provider: 'openai' }],
    tool_use: [{ model: 'gpt-4o-mini', provider: 'openai' }],
    creative: [{ model: 'gpt-4o-mini', provider: 'openai' }],
    analysis: [{ model: 'gpt-4o-mini', provider: 'openai' }],
    coding: [{ model: 'gpt-4o-mini', provider: 'openai' }],
    general: [{ model: 'gpt-4o-mini', provider: 'openai' }],
  },
};

// ─── Authority Levels ───────────────────────────────────────────────────────

export const AUTHORITY_LEVELS: Record<InputSource, number> = {
  creator: 100,
  self: 80,
  peer: 40,
  heartbeat: 60,
  external: 20,
};

// ─── Survival Tier Thresholds (credits in cents) ───────────────────────────

export const SURVIVAL_THRESHOLDS: Record<string, number> = {
  high: 500,       // > $5.00
  normal: 50,      // > $0.50
  low_compute: 10, // > $0.10
  critical: 0,     // >= $0.00
  dead: -1,        // unreachable via credits alone
};

export function calculateSurvivalTier(creditsCents: number): SurvivalTier {
  if (creditsCents >= SURVIVAL_THRESHOLDS.high) return 'high';
  if (creditsCents >= SURVIVAL_THRESHOLDS.normal) return 'normal';
  if (creditsCents >= SURVIVAL_THRESHOLDS.low_compute) return 'low_compute';
  if (creditsCents >= 0) return 'critical';
  return 'dead';
}

export const DEFAULT_MODEL_STRATEGY: ModelStrategy = {
  routingMatrix: DEFAULT_ROUTING_MATRIX,
  fallbackModels: ['gpt-4o-mini'],
  budgetHourlyCents: 200, // $2
  budgetDailyCents: 2000, // $20
};
