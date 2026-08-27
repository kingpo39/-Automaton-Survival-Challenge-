/**
 * Conway Automaton — Database Layer
 * SQLite via sql.js with synchronous wrapper providing better-sqlite3-like API.
 */

import initSqlJs from 'sql.js';
import type { SqlJsDatabase, SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { SCHEMA_VERSION, getMigrationSQL } from './schema.js';
import { createLogger } from '../observability/logger.js';
import type {
  AutomatonDatabase, TurnRecord, ToolCallRecord, TransactionRecord,
  SkillRecord, ChildRecord, InboxMessageRecord, PolicyDecisionRecord,
  SpendRecord, HeartbeatScheduleEntry, HeartbeatHistoryRecord, WakeEvent,
  SoulHistoryRecord, WorkingMemoryRecord, EpisodicMemoryRecord,
  SemanticMemoryRecord, ProceduralMemoryRecord, RelationshipMemoryRecord,
  InferenceCostRecord, ModelRegistryEntry, ChildLifecycleEvent,
  DiscoveredAgentCache, OnchainTransactionRecord, ModificationRecord,
  MetricSnapshotRecord, SessionSummaryRecord,
} from '../types.js';

const logger = createLogger('database');

let sqlStatic: SqlJsStatic | null = null;

async function getSql(): Promise<SqlJsStatic> {
  if (!sqlStatic) {
    sqlStatic = await initSqlJs();
  }
  return sqlStatic;
}

class AutomatonDatabaseImpl implements AutomatonDatabase {
  private db: SqlJsDatabase;
  private dbPath: string;

  private constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  static async open(dbPath: string): Promise<AutomatonDatabaseImpl> {
    const SQL = await getSql();
    let db: SqlJsDatabase;

    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(new Uint8Array(buffer));
    } else {
      db = new SQL.Database();
    }

    // Enable WAL-like behavior (sql.js doesn't have WAL, but we enable foreign keys)
    db.run('PRAGMA foreign_keys = ON');

    const instance = new AutomatonDatabaseImpl(db, dbPath);

    // Run migrations
    instance.runMigrations();

    return instance;
  }

  private runMigrations(): void {
    // Check current version
    let currentVersion = 0;
    try {
      const result = this.db.exec('SELECT version FROM schema_version LIMIT 1');
      if (result.length > 0 && result[0].values.length > 0) {
        currentVersion = result[0].values[0][0] as number;
      }
    } catch {
      // No schema_version table yet
      this.db.run('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    }

    if (currentVersion < SCHEMA_VERSION) {
      const sqls = getMigrationSQL(currentVersion);
      for (const sql of sqls) {
        try {
          this.db.run(sql);
        } catch (err) {
          logger.error('Migration failed', { sql: sql.substring(0, 100), error: String(err) });
        }
      }
      // Update version
      this.db.run('DELETE FROM schema_version');
      this.db.run('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION]);
      this.save();
      logger.info('Database migrated', { from: currentVersion, to: SCHEMA_VERSION });
    }
  }

  save(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
  }

  close(): void {
    this.save();
    this.db.close();
  }

  pragma(pragma: string): unknown {
    const result = this.db.exec(`PRAGMA ${pragma}`);
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0];
    }
    return null;
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private run(sql: string, params: unknown[] = []): void {
    this.db.run(sql, params as (string | number | null)[]);
    this.save();
  }

  private get<T>(sql: string, params: unknown[] = []): T | undefined {
    const result = this.db.exec(sql, params as (string | number | null)[]);
    if (result.length === 0 || result[0].values.length === 0) return undefined;
    return this.rowToObject<T>(result[0]);
  }

  private all<T>(sql: string, params: unknown[] = []): T[] {
    const result = this.db.exec(sql, params as (string | number | null)[]);
    if (result.length === 0) return [];
    return result[0].values.map(row => {
      const obj: Record<string, unknown> = {};
      result[0].columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj as T;
    });
  }

  private rowToObject<T>(result: { columns: string[]; values: unknown[][] }): T {
    const row = result.values[0];
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj as T;
  }

  private lastInsertRowid(): number {
    const result = this.db.exec('SELECT last_insert_rowid()');
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as number;
    }
    return 0;
  }

  // ── Identity ────────────────────────────────────────────────────

  getIdentity(key: string): string | undefined {
    const row = this.get<{ value: string }>('SELECT value FROM identity WHERE key = ?', [key]);
    return row?.value;
  }

  setIdentity(key: string, value: string): void {
    this.run(
      'INSERT OR REPLACE INTO identity (key, value, updated_at) VALUES (?, ?, ?)',
      [key, value, Date.now()]
    );
  }

  // ── Turns ───────────────────────────────────────────────────────

  insertTurn(turn: TurnRecord): number {
    this.run(
      `INSERT INTO turns (timestamp, state, thinking, tool_calls, response, prompt_tokens, completion_tokens, cost_cents, model, input_source, inbox_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [turn.timestamp, turn.state, turn.thinking, turn.toolCalls, turn.response,
       turn.promptTokens, turn.completionTokens, turn.costCents, turn.model,
       turn.inputSource, turn.inboxMessageId ?? null]
    );
    return this.lastInsertRowid();
  }

  getTurn(id: number): TurnRecord | undefined {
    return this.get<TurnRecord>('SELECT * FROM turns WHERE id = ?', [id]);
  }

  getRecentTurns(limit: number): TurnRecord[] {
    return this.all<TurnRecord>('SELECT * FROM turns ORDER BY id DESC LIMIT ?', [limit]);
  }

  // ── Tool Calls ──────────────────────────────────────────────────

  insertToolCall(call: ToolCallRecord): number {
    this.run(
      `INSERT INTO tool_calls (turn_id, name, arguments, result, risk_level, allowed, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [call.turnId, call.name, call.arguments, call.result, call.riskLevel,
       call.allowed ? 1 : 0, call.durationMs]
    );
    return this.lastInsertRowid();
  }

  getToolCallsForTurn(turnId: number): ToolCallRecord[] {
    return this.all<ToolCallRecord>('SELECT * FROM tool_calls WHERE turn_id = ?', [turnId]);
  }

  // ── KV Store ────────────────────────────────────────────────────

  getKV(key: string): string | undefined {
    const row = this.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
    return row?.value;
  }

  setKV(key: string, value: string): void {
    this.run(
      'INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)',
      [key, value, Date.now()]
    );
  }

  deleteKV(key: string): void {
    this.run('DELETE FROM kv WHERE key = ?', [key]);
  }

  // ── Transactions ────────────────────────────────────────────────

  insertTransaction(tx: TransactionRecord): number {
    this.run(
      'INSERT INTO transactions (timestamp, type, amount_cents, description, tx_hash) VALUES (?, ?, ?, ?, ?)',
      [tx.timestamp, tx.type, tx.amountCents, tx.description, tx.txHash ?? null]
    );
    return this.lastInsertRowid();
  }

  // ── Skills ──────────────────────────────────────────────────────

  getSkill(name: string): SkillRecord | undefined {
    return this.get<SkillRecord>('SELECT * FROM skills WHERE name = ?', [name]);
  }

  listSkills(): SkillRecord[] {
    return this.all<SkillRecord>('SELECT * FROM skills ORDER BY name');
  }

  upsertSkill(skill: SkillRecord): void {
    this.run(
      `INSERT OR REPLACE INTO skills (name, description, triggers, content, version, installed_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [skill.name, skill.description, JSON.stringify(skill.triggers), skill.content,
       skill.version, skill.installedAt, skill.source ?? null]
    );
  }

  deleteSkill(name: string): void {
    this.run('DELETE FROM skills WHERE name = ?', [name]);
  }

  // ── Children ────────────────────────────────────────────────────

  getChild(id: string): ChildRecord | undefined {
    return this.get<ChildRecord>('SELECT * FROM children WHERE id = ?', [id]);
  }

  listChildren(): ChildRecord[] {
    return this.all<ChildRecord>('SELECT * FROM children ORDER BY created_at DESC');
  }

  upsertChild(child: ChildRecord): void {
    this.run(
      `INSERT OR REPLACE INTO children (id, name, parent_address, sandbox_id, wallet_address, state, created_at, last_health_check, constitution_hash, genesis_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [child.id, child.name, child.parentAddress, child.sandboxId, child.walletAddress,
       child.state, child.createdAt, child.lastHealthCheck ?? null,
       child.constitutionHash ?? null, child.genesisConfig]
    );
  }

  deleteChild(id: string): void {
    this.run('DELETE FROM children WHERE id = ?', [id]);
  }

  // ── Registry ────────────────────────────────────────────────────

  getRegistryEntry(key: string): string | undefined {
    const row = this.get<{ value: string }>('SELECT value FROM registry WHERE key = ?', [key]);
    return row?.value;
  }

  setRegistryEntry(key: string, value: string): void {
    this.run(
      'INSERT OR REPLACE INTO registry (key, value, updated_at) VALUES (?, ?, ?)',
      [key, value, Date.now()]
    );
  }

  // ── Reputation ──────────────────────────────────────────────────

  getReputation(agentAddress: string): number {
    const row = this.get<{ score: number }>('SELECT score FROM reputation WHERE agent_address = ?', [agentAddress]);
    return row?.score ?? 0.5;
  }

  setReputation(agentAddress: string, score: number): void {
    this.run(
      'INSERT OR REPLACE INTO reputation (agent_address, score, updated_at) VALUES (?, ?, ?)',
      [agentAddress, score, Date.now()]
    );
  }

  // ── Inbox ───────────────────────────────────────────────────────

  getUnprocessedInboxMessages(): InboxMessageRecord[] {
    return this.all<InboxMessageRecord>(
      "SELECT * FROM inbox_messages WHERE state IN ('received', 'failed') AND retry_count < 3 ORDER BY timestamp"
    );
  }

  markInProgress(messageId: string): void {
    this.run("UPDATE inbox_messages SET state = 'in_progress' WHERE id = ?", [messageId]);
  }

  markCompleted(messageId: string): void {
    this.run("UPDATE inbox_messages SET state = 'completed' WHERE id = ?", [messageId]);
  }

  markFailed(messageId: string): void {
    this.run(
      "UPDATE inbox_messages SET state = 'failed', retry_count = retry_count + 1 WHERE id = ?",
      [messageId]
    );
  }

  insertInboxMessage(msg: InboxMessageRecord): void {
    this.run(
      `INSERT OR IGNORE INTO inbox_messages (id, from_address, from_name, content, signature, timestamp, state, retry_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [msg.id, msg.from, msg.fromName ?? null, msg.content, msg.signature,
       msg.timestamp, msg.state, msg.retryCount]
    );
  }

  // ── Policy Decisions ────────────────────────────────────────────

  insertPolicyDecision(decision: PolicyDecisionRecord): void {
    this.run(
      `INSERT INTO policy_decisions (timestamp, tool_name, action, reason, rule, category, input_source, params)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [decision.timestamp, decision.toolName, decision.action, decision.reason,
       decision.rule, decision.category, decision.inputSource, decision.params]
    );
  }

  // ── Spend Tracking ──────────────────────────────────────────────

  insertSpendRecord(record: SpendRecord): void {
    this.run(
      'INSERT INTO spend_tracking (timestamp, category, amount_cents, description) VALUES (?, ?, ?, ?)',
      [record.timestamp, record.category, record.amountCents, record.description]
    );
  }

  getSpendTotal(category: string, windowMs: number): number {
    const since = Date.now() - windowMs;
    const row = this.get<{ total: number }>(
      'SELECT COALESCE(SUM(amount_cents), 0) as total FROM spend_tracking WHERE category = ? AND timestamp > ?',
      [category, since]
    );
    return row?.total ?? 0;
  }

  // ── Heartbeat Schedule ──────────────────────────────────────────

  getHeartbeatSchedule(): HeartbeatScheduleEntry[] {
    return this.all<HeartbeatScheduleEntry>('SELECT * FROM heartbeat_schedule WHERE enabled = 1');
  }

  upsertHeartbeatSchedule(entry: HeartbeatScheduleEntry): void {
    this.run(
      `INSERT OR REPLACE INTO heartbeat_schedule (task_id, schedule, enabled, min_tier, lease_ttl_ms, config)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.taskId, entry.schedule, entry.enabled ? 1 : 0, entry.minTier,
       entry.leaseTtlMs, entry.config]
    );
  }

  insertHeartbeatHistory(entry: HeartbeatHistoryRecord): void {
    this.run(
      `INSERT INTO heartbeat_history (task_id, timestamp, success, result, duration_ms, should_wake)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.taskId, entry.timestamp, entry.success ? 1 : 0, entry.result,
       entry.durationMs, entry.shouldWake ? 1 : 0]
    );
  }

  acquireLease(taskId: string, ttlMs: number): boolean {
    const now = Date.now();
    const row = this.get<{ task_id: string }>(
      `SELECT task_id FROM heartbeat_schedule WHERE task_id = ? AND (lease_expires IS NULL OR lease_expires < ?)`,
      [taskId, now]
    );
    if (!row) return false;
    this.run(
      'UPDATE heartbeat_schedule SET lease_expires = ? WHERE task_id = ?',
      [now + ttlMs, taskId]
    );
    return true;
  }

  releaseLease(taskId: string): void {
    this.run('UPDATE heartbeat_schedule SET lease_expires = NULL WHERE task_id = ?', [taskId]);
  }

  // ── Wake Events ─────────────────────────────────────────────────

  insertWakeEvent(event: WakeEvent): void {
    this.run(
      'INSERT INTO wake_events (source, reason, timestamp, consumed) VALUES (?, ?, ?, 0)',
      [event.source, event.reason, event.timestamp]
    );
  }

  consumeWakeEvents(): WakeEvent[] {
    const events = this.all<WakeEvent>(
      'SELECT * FROM wake_events WHERE consumed = 0 ORDER BY timestamp'
    );
    if (events.length > 0) {
      this.run('UPDATE wake_events SET consumed = 1 WHERE consumed = 0');
    }
    return events;
  }

  hasPendingWakeEvent(): boolean {
    const row = this.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM wake_events WHERE consumed = 0'
    );
    return (row?.cnt ?? 0) > 0;
  }

  // ── Heartbeat Dedup ─────────────────────────────────────────────

  isDedupKeyPresent(key: string): boolean {
    const now = Date.now();
    // Cleanup expired
    this.run('DELETE FROM heartbeat_dedup WHERE expires_at < ?', [now]);
    const row = this.get<{ key: string }>('SELECT key FROM heartbeat_dedup WHERE key = ?', [key]);
    return !!row;
  }

  setDedupKey(key: string, ttlMs: number): void {
    this.run(
      'INSERT OR REPLACE INTO heartbeat_dedup (key, expires_at) VALUES (?, ?)',
      [key, Date.now() + ttlMs]
    );
  }

  // ── Soul History ────────────────────────────────────────────────

  getSoulHistory(): SoulHistoryRecord[] {
    return this.all<SoulHistoryRecord>('SELECT * FROM soul_history ORDER BY id DESC');
  }

  insertSoulHistory(record: SoulHistoryRecord): void {
    this.run(
      `INSERT INTO soul_history (timestamp, content, content_hash, alignment_score, auto_updated)
       VALUES (?, ?, ?, ?, ?)`,
      [record.timestamp, record.content, record.contentHash,
       record.alignmentScore ?? null, record.autoUpdated ? 1 : 0]
    );
  }

  // ── Working Memory ──────────────────────────────────────────────

  getWorkingMemory(): WorkingMemoryRecord[] {
    const now = Date.now();
    return this.all<WorkingMemoryRecord>(
      'SELECT * FROM working_memory WHERE (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC',
      [now]
    );
  }

  insertWorkingMemory(record: WorkingMemoryRecord): void {
    this.run(
      'INSERT INTO working_memory (key, value, category, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      [record.key, record.value, record.category, record.createdAt, record.expiresAt ?? null]
    );
  }

  clearWorkingMemory(): void {
    this.run('DELETE FROM working_memory');
  }

  // ── Episodic Memory ─────────────────────────────────────────────

  getEpisodicMemory(limit = 50): EpisodicMemoryRecord[] {
    return this.all<EpisodicMemoryRecord>(
      'SELECT * FROM episodic_memory ORDER BY importance DESC, timestamp DESC LIMIT ?',
      [limit]
    );
  }

  insertEpisodicMemory(record: EpisodicMemoryRecord): void {
    this.run(
      `INSERT INTO episodic_memory (timestamp, event, classification, importance, turn_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [record.timestamp, record.event, record.classification, record.importance,
       record.turnId ?? null, record.metadata]
    );
  }

  // ── Semantic Memory ─────────────────────────────────────────────

  getSemanticMemory(category?: string): SemanticMemoryRecord[] {
    if (category) {
      return this.all<SemanticMemoryRecord>(
        'SELECT * FROM semantic_memory WHERE category = ? ORDER BY confidence DESC', [category]
      );
    }
    return this.all<SemanticMemoryRecord>('SELECT * FROM semantic_memory ORDER BY confidence DESC');
  }

  insertSemanticMemory(record: SemanticMemoryRecord): void {
    const now = Date.now();
    this.run(
      `INSERT OR REPLACE INTO semantic_memory (category, key, value, confidence, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [record.category, record.key, record.value, record.confidence, record.source,
       record.createdAt || now, now]
    );
  }

  deleteSemanticMemory(category: string, key: string): void {
    this.run('DELETE FROM semantic_memory WHERE category = ? AND key = ?', [category, key]);
  }

  // ── Procedural Memory ───────────────────────────────────────────

  getProceduralMemory(): ProceduralMemoryRecord[] {
    return this.all<ProceduralMemoryRecord>(
      'SELECT * FROM procedural_memory ORDER BY last_used DESC'
    );
  }

  insertProceduralMemory(record: ProceduralMemoryRecord): void {
    this.run(
      `INSERT OR REPLACE INTO procedural_memory (name, steps, success_count, fail_count, last_used, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [record.name, record.steps, record.successCount, record.failCount,
       record.lastUsed, record.createdAt]
    );
  }

  // ── Relationship Memory ─────────────────────────────────────────

  getRelationshipMemory(entityId: string): RelationshipMemoryRecord | undefined {
    return this.get<RelationshipMemoryRecord>(
      'SELECT * FROM relationship_memory WHERE entity_id = ?', [entityId]
    );
  }

  upsertRelationshipMemory(record: RelationshipMemoryRecord): void {
    this.run(
      `INSERT OR REPLACE INTO relationship_memory (entity_id, entity_type, trust_score, interaction_count, last_interaction, sentiment, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [record.entityId, record.entityType, record.trustScore,
       record.interactionCount, record.lastInteraction, record.sentiment,
       record.metadata]
    );
  }

  // ── Inference Costs ─────────────────────────────────────────────

  insertInferenceCost(record: InferenceCostRecord): void {
    this.run(
      `INSERT INTO inference_costs (timestamp, model, provider, prompt_tokens, completion_tokens, cost_cents, latency_ms, task_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.timestamp, record.model, record.provider, record.promptTokens,
       record.completionTokens, record.costCents, record.latencyMs, record.taskType]
    );
  }

  getInferenceCostTotal(windowMs: number): number {
    const since = Date.now() - windowMs;
    const row = this.get<{ total: number }>(
      'SELECT COALESCE(SUM(cost_cents), 0) as total FROM inference_costs WHERE timestamp > ?',
      [since]
    );
    return row?.total ?? 0;
  }

  // ── Model Registry ──────────────────────────────────────────────

  getModelRegistry(): ModelRegistryEntry[] {
    return this.all<ModelRegistryEntry>(
      'SELECT * FROM model_registry WHERE available = 1 ORDER BY pricing_per_1k_tokens'
    );
  }

  upsertModelRegistry(entry: ModelRegistryEntry): void {
    this.run(
      `INSERT OR REPLACE INTO model_registry (model, provider, pricing_per_1k_tokens, max_context, capabilities, available, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entry.model, entry.provider, entry.pricingPer1kTokens, entry.maxContext,
       JSON.stringify(entry.capabilities), entry.available ? 1 : 0, entry.updatedAt]
    );
  }

  // ── Child Lifecycle ─────────────────────────────────────────────

  insertChildLifecycleEvent(event: ChildLifecycleEvent): void {
    this.run(
      `INSERT INTO child_lifecycle_events (child_id, from_state, to_state, timestamp, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [event.childId, event.fromState, event.toState, event.timestamp, event.reason]
    );
  }

  // ── Discovered Agents ───────────────────────────────────────────

  getDiscoveredAgent(address: string): DiscoveredAgentCache | undefined {
    return this.get<DiscoveredAgentCache>(
      'SELECT * FROM discovered_agents_cache WHERE address = ?', [address]
    );
  }

  setDiscoveredAgent(agent: DiscoveredAgentCache): void {
    this.run(
      `INSERT OR REPLACE INTO discovered_agents_cache (address, name, agent_card, capabilities, last_seen)
       VALUES (?, ?, ?, ?, ?)`,
      [agent.address, agent.name, agent.agentCard,
       JSON.stringify(agent.capabilities), agent.lastSeen]
    );
  }

  // ── On-chain Transactions ───────────────────────────────────────

  insertOnchainTransaction(tx: OnchainTransactionRecord): void {
    this.run(
      `INSERT OR REPLACE INTO onchain_transactions (hash, from_address, to_address, value, chain, timestamp, block_number)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tx.hash, tx.from, tx.to, tx.value, tx.chain, tx.timestamp, tx.blockNumber]
    );
  }

  // ── Modifications ───────────────────────────────────────────────

  insertModification(mod: ModificationRecord): void {
    this.run(
      `INSERT INTO modifications (timestamp, type, file_path, diff, hash, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [mod.timestamp, mod.type, mod.filePath ?? null, mod.diff ?? null, mod.hash, mod.reason]
    );
  }

  // ── Metric Snapshots ────────────────────────────────────────────

  insertMetricSnapshot(snapshot: MetricSnapshotRecord): void {
    this.run(
      `INSERT INTO metric_snapshots (timestamp, counters, gauges, histograms, alerts)
       VALUES (?, ?, ?, ?, ?)`,
      [snapshot.timestamp, snapshot.counters, snapshot.gauges,
       snapshot.histograms, snapshot.alerts]
    );
  }

  // ── Session Summaries ───────────────────────────────────────────

  insertSessionSummary(summary: SessionSummaryRecord): void {
    this.run(
      `INSERT INTO session_summaries (session_start, session_end, turns_count, tools_used, outcome, total_cost_cents, memory_extracted)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [summary.sessionStart, summary.sessionEnd, summary.turnsCount,
       summary.toolsUsed, summary.outcome, summary.totalCostCents, summary.memoryExtracted]
    );
  }
}

export async function openDatabase(dbPath: string): Promise<AutomatonDatabase> {
  return AutomatonDatabaseImpl.open(dbPath);
}
