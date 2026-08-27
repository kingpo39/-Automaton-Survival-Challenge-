/**
 * Conway Automaton — Test Mocks
 * Mock clients for inference, Conway API, and social relay.
 */

import type {
  ConwayClient, InferenceClient, InferenceRequest, InferenceResponse,
  AutomatonDatabase, AutomatonConfig, RuntimeState,
} from '../types.js';
import { DEFAULT_TREASURY_POLICY, DEFAULT_SOUL_CONFIG, DEFAULT_MODEL_STRATEGY } from '../types.js';

// ── Mock Conway Client ────────────────────────────────────────────────────

export function createMockConwayClient(): ConwayClient {
  return {
    async exec(_sandboxId, command, _timeoutMs) {
      return { stdout: `executed: ${command}`, stderr: '', exitCode: 0 };
    },
    async writeFile(_sandboxId, _path, _content) {},
    async readFile(_sandboxId, _path) { return 'file content'; },
    async exposePort(_sandboxId, port) { return `http://localhost:${port}`; },
    async removePort(_sandboxId, _port) {},
    async createSandbox(name) { return { id: `sandbox-${name}` }; },
    async deleteSandbox(_sandboxId) {},
    async listSandboxes() { return []; },
    async getCreditsBalance() { return 1000; },
    async getCreditsPricing() { return { basic: 500, standard: 2500 }; },
    async transferCredits(_to, _amount) { return { txHash: '0xmock' }; },
    async searchDomains(_query) { return []; },
    async registerDomain(name) { return { domain: name }; },
    async listDnsRecords(_domain) { return []; },
    async addDnsRecord() {},
    async deleteDnsRecord() {},
    async listModels() {
      return [{ model: 'gpt-5.2', provider: 'openai', available: true }];
    },
  };
}

// ── Mock Inference Client ─────────────────────────────────────────────────

export function createMockInferenceClient(options?: {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  failWith?: Error;
}): InferenceClient {
  return {
    async chatCompletion(_request: InferenceRequest): Promise<InferenceResponse> {
      if (options?.failWith) throw options.failWith;
      return {
        content: options?.content ?? 'I will think about this.',
        toolCalls: options?.toolCalls ?? [],
        model: 'gpt-5.2',
        provider: 'openai',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        cost: 0.005,
        latencyMs: 200,
      };
    },
  };
}

// ── Mock Database ──────────────────────────────────────────────────────────

export function createMockDatabase(): AutomatonDatabase {
  const data: Record<string, unknown[]> = {};

  function getTable(name: string): unknown[] {
    if (!data[name]) data[name] = [];
    return data[name];
  }

  let autoId = 1;

  return {
    close() {},
    pragma(_pragma) { return null; },

    // Identity
    getIdentity(key: string) { return (data.identity as Array<{ key: string; value: string }> | undefined)?.find(i => i.key === key)?.value; },
    setIdentity(key: string, value: string) {
      const table = getTable('identity') as Array<{ key: string; value: string; updated_at: number }>;
      const idx = table.findIndex(i => i.key === key);
      if (idx >= 0) table[idx].value = value;
      else table.push({ key, value, updated_at: Date.now() });
    },

    // Turns
    insertTurn(turn) { const id = autoId++; getTable('turns').push({ id, ...turn }); return id; },
    getTurn(id: number) { return getTable('turns').find((t: any) => t.id === id); },
    getRecentTurns(limit) { return getTable('turns').slice(-limit); },

    // Tool calls
    insertToolCall(call) { const id = autoId++; getTable('tool_calls').push({ id, ...call }); return id; },
    getToolCallsForTurn(turnId) { return getTable('tool_calls').filter((c: any) => c.turnId === turnId); },

    // KV
    getKV(key: string) { return (data.kv as Array<{ key: string; value: string }> | undefined)?.find(k => k.key === key)?.value; },
    setKV(key: string, value: string) {
      const table = getTable('kv') as Array<{ key: string; value: string; updated_at: number }>;
      const idx = table.findIndex(k => k.key === key);
      if (idx >= 0) table[idx].value = value;
      else table.push({ key, value, updated_at: Date.now() });
    },
    deleteKV(key: string) {
      const table = getTable('kv') as Array<{ key: string }>;
      const idx = table.findIndex(k => k.key === key);
      if (idx >= 0) table.splice(idx, 1);
    },

    // Transactions
    insertTransaction(tx) { const id = autoId++; getTable('transactions').push({ id, ...tx }); return id; },

    // Skills
    getSkill(name) { return getTable('skills').find((s: any) => s.name === name); },
    listSkills() { return getTable('skills'); },
    upsertSkill(skill) {
      const table = getTable('skills') as any[];
      const idx = table.findIndex((s: any) => s.name === skill.name);
      if (idx >= 0) table[idx] = skill; else table.push(skill);
    },
    deleteSkill(name) {
      const table = getTable('skills') as any[];
      const idx = table.findIndex((s: any) => s.name === name);
      if (idx >= 0) table.splice(idx, 1);
    },

    // Children
    getChild(id) { return getTable('children').find((c: any) => c.id === id); },
    listChildren() { return getTable('children'); },
    upsertChild(child) {
      const table = getTable('children') as any[];
      const idx = table.findIndex((c: any) => c.id === child.id);
      if (idx >= 0) table[idx] = child; else table.push(child);
    },
    deleteChild(id) {
      const table = getTable('children') as any[];
      const idx = table.findIndex((c: any) => c.id === id);
      if (idx >= 0) table.splice(idx, 1);
    },

    // Registry
    getRegistryEntry(key) { return (data.registry as Array<{ key: string; value: string }> | undefined)?.find(r => r.key === key)?.value; },
    setRegistryEntry(key, value) {
      const table = getTable('registry') as Array<{ key: string; value: string; updated_at: number }>;
      const idx = table.findIndex(r => r.key === key);
      if (idx >= 0) table[idx].value = value;
      else table.push({ key, value, updated_at: Date.now() });
    },

    // Reputation
    getReputation(address) { return (data.reputation as Array<{ agent_address: string; score: number }> | undefined)?.find(r => r.agent_address === address)?.score ?? 0.5; },
    setReputation(address, score) {
      const table = getTable('reputation') as Array<{ agent_address: string; score: number; updated_at: number }>;
      const idx = table.findIndex(r => r.agent_address === address);
      if (idx >= 0) table[idx].score = score;
      else table.push({ agent_address: address, score, updated_at: Date.now() });
    },

    // Inbox
    getUnprocessedInboxMessages() { return getTable('inbox_messages').filter((m: any) => m.state === 'received' || m.state === 'failed'); },
    markInProgress(id) { const msg = getTable('inbox_messages').find((m: any) => m.id === id) as any; if (msg) msg.state = 'in_progress'; },
    markCompleted(id) { const msg = getTable('inbox_messages').find((m: any) => m.id === id) as any; if (msg) msg.state = 'completed'; },
    markFailed(id) { const msg = getTable('inbox_messages').find((m: any) => m.id === id) as any; if (msg) { msg.state = 'failed'; msg.retryCount = (msg.retryCount ?? 0) + 1; } },
    insertInboxMessage(msg) { getTable('inbox_messages').push(msg); },

    // Policy
    insertPolicyDecision(d) { getTable('policy_decisions').push(d); },

    // Spend
    insertSpendRecord(r) { getTable('spend_tracking').push(r); },
    getSpendTotal(_category, _windowMs) { return 0; },

    // Heartbeat
    getHeartbeatSchedule() { return getTable('heartbeat_schedule'); },
    upsertHeartbeatSchedule(entry) {
      const table = getTable('heartbeat_schedule') as any[];
      const idx = table.findIndex((e: any) => e.taskId === entry.taskId);
      if (idx >= 0) table[idx] = entry; else table.push(entry);
    },
    insertHeartbeatHistory(entry) { getTable('heartbeat_history').push(entry); },
    acquireLease(_taskId, _ttl) { return true; },
    releaseLease(_taskId) {},

    // Wake events
    insertWakeEvent(event) { getTable('wake_events').push(event); },
    consumeWakeEvents() {
      const events = getTable('wake_events').filter((e: any) => !e.consumed);
      events.forEach((e: any) => e.consumed = true);
      return events;
    },
    hasPendingWakeEvent() { return getTable('wake_events').some((e: any) => !e.consumed); },

    // Dedup
    isDedupKeyPresent(key) { return getTable('dedup_keys').some((d: any) => d.key === key && d.expiresAt > Date.now()); },
    setDedupKey(key, ttl) { const table = getTable('dedup_keys') as any[]; const idx = table.findIndex((d: any) => d.key === key); if (idx >= 0) table[idx] = { key, expiresAt: Date.now() + ttl }; else table.push({ key, expiresAt: Date.now() + ttl }); },

    // Soul
    getSoulHistory() { return getTable('soul_history'); },
    insertSoulHistory(record) { getTable('soul_history').push(record); },

    // Memory
    getWorkingMemory() { return getTable('working_memory'); },
    insertWorkingMemory(r) { getTable('working_memory').push(r); },
    clearWorkingMemory() { data.working_memory = []; },

    getEpisodicMemory(_limit) { return getTable('episodic_memory').slice(0, _limit); },
    insertEpisodicMemory(r) { getTable('episodic_memory').push(r); },

    getSemanticMemory(category) {
      const all = getTable('semantic_memory');
      return category ? all.filter((r: any) => r.category === category) : all;
    },
    insertSemanticMemory(r) {
      const table = getTable('semantic_memory') as any[];
      const idx = table.findIndex((t: any) => t.category === r.category && t.key === r.key);
      if (idx >= 0) table[idx] = r; else table.push(r);
    },
    deleteSemanticMemory(category, key) {
      const table = getTable('semantic_memory') as any[];
      const idx = table.findIndex((t: any) => t.category === category && t.key === key);
      if (idx >= 0) table.splice(idx, 1);
    },

    getProceduralMemory() { return getTable('procedural_memory'); },
    insertProceduralMemory(r) {
      const table = getTable('procedural_memory') as any[];
      const idx = table.findIndex((t: any) => t.name === r.name);
      if (idx >= 0) table[idx] = r; else table.push(r);
    },

    getRelationshipMemory(entityId) { return getTable('relationship_memory').find((r: any) => r.entityId === entityId); },
    upsertRelationshipMemory(r) {
      const table = getTable('relationship_memory') as any[];
      const idx = table.findIndex((t: any) => t.entityId === r.entityId);
      if (idx >= 0) table[idx] = r; else table.push(r);
    },

    // Inference costs
    insertInferenceCost(r) { getTable('inference_costs').push(r); },
    getInferenceCostTotal(_windowMs) { return 0; },

    // Model registry
    getModelRegistry() { return getTable('model_registry'); },
    upsertModelRegistry(entry) {
      const table = getTable('model_registry') as any[];
      const idx = table.findIndex((e: any) => e.model === entry.model);
      if (idx >= 0) table[idx] = entry; else table.push(entry);
    },

    // Child lifecycle
    insertChildLifecycleEvent(e) { getTable('child_lifecycle_events').push(e); },

    // Discovered agents
    getDiscoveredAgent(address) { return getTable('discovered_agents_cache').find((a: any) => a.address === address); },
    setDiscoveredAgent(a) {
      const table = getTable('discovered_agents_cache') as any[];
      const idx = table.findIndex((t: any) => t.address === a.address);
      if (idx >= 0) table[idx] = a; else table.push(a);
    },

    // On-chain
    insertOnchainTransaction(tx) { getTable('onchain_transactions').push(tx); },

    // Modifications
    insertModification(m) { getTable('modifications').push(m); },

    // Metrics
    insertMetricSnapshot(s) { getTable('metric_snapshots').push(s); },

    // Session summaries
    insertSessionSummary(s) { getTable('session_summaries').push(s); },
  };
}

// ── Default Config ─────────────────────────────────────────────────────────

export function createMockConfig(overrides?: Partial<AutomatonConfig>): AutomatonConfig {
  return {
    name: 'test-automaton',
    genesisPrompt: 'You are a test automaton.',
    creatorAddress: '0xcreator',
    sandboxId: '',
    conwayApiUrl: 'https://api.conway.tech',
    conwayApiKey: 'test-key',
    inferenceModel: 'gpt-5.2',
    maxTokensPerTurn: 4096,
    heartbeatConfigPath: '/tmp/heartbeat.yml',
    dbPath: '/tmp/test.db',
    logLevel: 'info',
    walletAddress: '0xwallet',
    version: '0.1.0',
    skillsDir: '/tmp/skills',
    maxChildren: 3,
    treasuryPolicy: { ...DEFAULT_TREASURY_POLICY },
    soulConfig: { ...DEFAULT_SOUL_CONFIG },
    modelStrategy: { ...DEFAULT_MODEL_STRATEGY, routingMatrix: { ...DEFAULT_MODEL_STRATEGY.routingMatrix } },
    ...overrides,
  };
}

export function createMockState(overrides?: Partial<RuntimeState>): RuntimeState {
  return {
    agentState: 'running',
    survivalTier: 'normal',
    creditsBalanceCents: 1000,
    usdcBalanceMicrogons: 10_000_000,
    turnNumber: 0,
    sessionTurnCount: 0,
    currentModel: 'gpt-5.2',
    idleTurnCount: 0,
    lastWakeTime: Date.now(),
    lastSleepTime: 0,
    totalTokensUsed: 0,
    totalCostCents: 0,
    activeChildren: 0,
    ...overrides,
  };
}
