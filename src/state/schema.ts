/**
 * Conway Automaton — Database Schema + Migrations
 * SQLite schema with incremental migrations v1-v8.
 */

export const SCHEMA_VERSION = 8;

export const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS identity (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      state TEXT NOT NULL,
      thinking TEXT NOT NULL DEFAULT '',
      tool_calls TEXT NOT NULL DEFAULT '[]',
      response TEXT NOT NULL DEFAULT '',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cost_cents INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      input_source TEXT NOT NULL DEFAULT 'self',
      inbox_message_id TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      arguments TEXT NOT NULL DEFAULT '{}',
      result TEXT NOT NULL DEFAULT '{}',
      risk_level TEXT NOT NULL DEFAULT 'safe',
      allowed INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (turn_id) REFERENCES turns(id)
    )`,
    `CREATE TABLE IF NOT EXISTS heartbeat_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      description TEXT NOT NULL,
      tx_hash TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS installed_tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      installed_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS modifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT,
      diff TEXT,
      hash TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
  ],

  2: [
    `CREATE TABLE IF NOT EXISTS skills (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      triggers TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      installed_at INTEGER NOT NULL,
      source TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_address TEXT NOT NULL,
      sandbox_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'spawning',
      created_at INTEGER NOT NULL,
      last_health_check INTEGER,
      constitution_hash TEXT,
      genesis_config TEXT NOT NULL DEFAULT '{}'
    )`,
    `CREATE TABLE IF NOT EXISTS registry (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE TABLE IF NOT EXISTS reputation (
      agent_address TEXT PRIMARY KEY,
      score REAL NOT NULL DEFAULT 0.5,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
  ],

  3: [
    `CREATE TABLE IF NOT EXISTS inbox_messages (
      id TEXT PRIMARY KEY,
      from_address TEXT NOT NULL,
      from_name TEXT,
      content TEXT NOT NULL,
      signature TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'received',
      retry_count INTEGER NOT NULL DEFAULT 0
    )`,
  ],

  4: [
    `CREATE TABLE IF NOT EXISTS policy_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      rule TEXT NOT NULL,
      category TEXT NOT NULL,
      input_source TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}'
    )`,
    `CREATE TABLE IF NOT EXISTS spend_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      category TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS heartbeat_schedule (
      task_id TEXT PRIMARY KEY,
      schedule TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      min_tier TEXT NOT NULL DEFAULT 'normal',
      lease_ttl_ms INTEGER NOT NULL DEFAULT 60000,
      config TEXT NOT NULL DEFAULT '{}'
    )`,
    `CREATE TABLE IF NOT EXISTS heartbeat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      success INTEGER NOT NULL,
      result TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      should_wake INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS wake_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      reason TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS heartbeat_dedup (
      key TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )`,
  ],

  5: [
    `CREATE TABLE IF NOT EXISTS soul_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      alignment_score REAL,
      auto_updated INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS working_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS episodic_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      event TEXT NOT NULL,
      classification TEXT NOT NULL DEFAULT 'general',
      importance REAL NOT NULL DEFAULT 0.5,
      turn_id INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}'
    )`,
    `CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_start INTEGER NOT NULL,
      session_end INTEGER NOT NULL,
      turns_count INTEGER NOT NULL DEFAULT 0,
      tools_used TEXT NOT NULL DEFAULT '[]',
      outcome TEXT NOT NULL DEFAULT '',
      total_cost_cents INTEGER NOT NULL DEFAULT 0,
      memory_extracted INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS semantic_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      source TEXT NOT NULL DEFAULT 'self',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(category, key)
    )`,
    `CREATE TABLE IF NOT EXISTS procedural_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      steps TEXT NOT NULL DEFAULT '[]',
      success_count INTEGER NOT NULL DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_used INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS relationship_memory (
      entity_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL DEFAULT 'agent',
      trust_score REAL NOT NULL DEFAULT 0.5,
      interaction_count INTEGER NOT NULL DEFAULT 0,
      last_interaction INTEGER NOT NULL,
      sentiment REAL NOT NULL DEFAULT 0.0,
      metadata TEXT NOT NULL DEFAULT '{}'
    )`,
  ],

  6: [
    `CREATE TABLE IF NOT EXISTS inference_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cost_cents INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      task_type TEXT NOT NULL DEFAULT 'general'
    )`,
    `CREATE TABLE IF NOT EXISTS model_registry (
      model TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      pricing_per_1k_tokens REAL NOT NULL DEFAULT 0,
      max_context INTEGER NOT NULL DEFAULT 128000,
      capabilities TEXT NOT NULL DEFAULT '[]',
      available INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    )`,
  ],

  7: [
    `CREATE TABLE IF NOT EXISTS child_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS discovered_agents_cache (
      address TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      agent_card TEXT NOT NULL DEFAULT '{}',
      capabilities TEXT NOT NULL DEFAULT '[]',
      last_seen INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS onchain_transactions (
      hash TEXT PRIMARY KEY,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      value TEXT NOT NULL,
      chain TEXT NOT NULL DEFAULT 'base',
      timestamp INTEGER NOT NULL,
      block_number INTEGER NOT NULL DEFAULT 0
    )`,
  ],

  8: [
    `CREATE TABLE IF NOT EXISTS metric_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      counters TEXT NOT NULL DEFAULT '{}',
      gauges TEXT NOT NULL DEFAULT '{}',
      histograms TEXT NOT NULL DEFAULT '{}',
      alerts TEXT NOT NULL DEFAULT '[]'
    )`,
  ],
};

/**
 * Apply all pending migrations from the current version to SCHEMA_VERSION.
 */
export function getMigrationSQL(currentVersion: number): string[] {
  const sqls: string[] = [];
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (migration) {
      sqls.push(...migration);
    }
  }
  return sqls;
}
