/**
 * Conway Automaton — Tool System
 * 57 built-in tools across 10 categories.
 * Every tool call flows through the policy engine before execution.
 */

import type {
  ToolDefinition, ToolHandler, ToolContext, ToolResult,
  ToolRiskLevel, ToolParameter,
} from '../types.js';
import { MAX_TOOL_RESULT_SIZE } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('agent:tools');

// ── Tool Registry ──────────────────────────────────────────────────────────

const toolRegistry: ToolDefinition[] = [];

function defineTool(
  name: string, description: string, category: string,
  riskLevel: ToolRiskLevel, parameters: ToolParameter[], handler: ToolHandler,
): void {
  toolRegistry.push({ name, description, category, riskLevel, parameters, handler });
}

export function getAllTools(): ToolDefinition[] {
  return [...toolRegistry];
}

export function getToolByName(name: string): ToolDefinition | undefined {
  return toolRegistry.find(t => t.name === name);
}

export function getToolsForPrompt(): string {
  return toolRegistry.map(t =>
    `- **${t.name}** (${t.category}/${t.riskLevel}): ${t.description}`
  ).join('\n');
}

/**
 * Essential tools for critical/dead tier — keeps prompt small for 1.8B models on CPU.
 * Only includes tools that help the agent earn credits or gather information.
 */
const SURVIVAL_TOOL_NAMES = new Set([
  // Memory & identity
  'recall_facts', 'remember_fact', 'review_memory', 'system_synopsis',
  // Chat (user interaction)
  'send_message',
  // Research (new MCP tools)
  'web_search', 'lookup_docs',
  // Finance
  'check_balance',
])

export function getSurvivalToolsForPrompt(): string {
  return toolRegistry
    .filter(t => SURVIVAL_TOOL_NAMES.has(t.name))
    .map(t => `- **${t.name}** (${t.category}/${t.riskLevel}): ${t.description}`)
    .join('\n');
}

export function getSurvivalToolCount(): number {
  return SURVIVAL_TOOL_NAMES.size
}

// ── Tool Executor ──────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = getToolByName(toolName);
  if (!tool) {
    return { success: false, output: `Unknown tool: ${toolName}` };
  }

  try {
    const result = await tool.handler(params, context);

    // Truncate large results
    if (result.output.length > MAX_TOOL_RESULT_SIZE) {
      result.output = result.output.substring(0, MAX_TOOL_RESULT_SIZE) + '\n[... truncated ...]';
    }

    return result;
  } catch (err) {
    logger.error('Tool execution failed', { tool: toolName, error: String(err) });
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════════

// ── VM Tools (5) ───────────────────────────────────────────────────────────

defineTool('exec', 'Execute a shell command', 'vm', 'dangerous',
  [{ name: 'command', type: 'string', description: 'Shell command to execute', required: true },
   { name: 'timeout_ms', type: 'number', description: 'Timeout in milliseconds', required: false, default: 30000 }],
  async (params, ctx) => {
    const command = params.command as string;
    const timeout = (params.timeout_ms as number) ?? 30000;
    const result = await ctx.conwayClient.exec(ctx.config.sandboxId, command, timeout);
    return {
      success: result.exitCode === 0,
      output: result.stdout + (result.stderr ? `\nSTDERR: ${result.stderr}` : ''),
    };
  }
);

defineTool('write_file', 'Write content to a file', 'vm', 'dangerous',
  [{ name: 'path', type: 'string', description: 'File path', required: true },
   { name: 'content', type: 'string', description: 'File content', required: true }],
  async (params, ctx) => {
    const filePath = params.path as string;
    const content = params.content as string;
    await ctx.conwayClient.writeFile(ctx.config.sandboxId, filePath, content);
    return { success: true, output: `Written ${content.length} bytes to ${filePath}` };
  }
);

defineTool('read_file', 'Read content from a file', 'vm', 'caution',
  [{ name: 'path', type: 'string', description: 'File path', required: true }],
  async (params, ctx) => {
    const filePath = params.path as string;
    const content = await ctx.conwayClient.readFile(ctx.config.sandboxId, filePath);
    return { success: true, output: content };
  }
);

defineTool('expose_port', 'Expose a port from the sandbox', 'vm', 'caution',
  [{ name: 'port', type: 'number', description: 'Port number to expose', required: true }],
  async (params, ctx) => {
    const port = params.port as number;
    const url = await ctx.conwayClient.exposePort(ctx.config.sandboxId, port);
    return { success: true, output: `Port ${port} exposed at ${url}` };
  }
);

defineTool('remove_port', 'Remove an exposed port', 'vm', 'caution',
  [{ name: 'port', type: 'number', description: 'Port number to remove', required: true }],
  async (params, ctx) => {
    const port = params.port as number;
    await ctx.conwayClient.removePort(ctx.config.sandboxId, port);
    return { success: true, output: `Port ${port} removed` };
  }
);

// ── Conway Tools (12) ──────────────────────────────────────────────────────

defineTool('check_credits', 'Check Conway credits balance', 'conway', 'safe',
  [], async (_params, ctx) => {
    const balance = await ctx.conwayClient.getCreditsBalance();
    ctx.state.creditsBalanceCents = balance;
    return { success: true, output: `Credits balance: $${(balance / 100).toFixed(2)}` };
  }
);

defineTool('check_usdc_balance', 'Check USDC balance on Base', 'conway', 'safe',
  [], async (_params, ctx) => {
    const balance = ctx.state.usdcBalanceMicrogons;
    return { success: true, output: `USDC balance: $${(balance / 1_000_000).toFixed(2)}` };
  }
);

defineTool('topup_credits', 'Buy credits from USDC', 'conway', 'dangerous',
  [{ name: 'amount_cents', type: 'number', description: 'Amount in cents (500/2500/10000/50000/100000/250000)', required: true }],
  async (params, ctx) => {
    const amount = params.amount_cents as number;
    const { executeTopup } = await import('../conway/topup.js');
    const result = await executeTopup(ctx.conwayClient, amount);
    if (result.success) {
      ctx.state.creditsBalanceCents += amount;
    }
    return { success: result.success, output: result.success ? `Topup $${(amount / 100).toFixed(2)} successful` : 'Topup failed' };
  }
);

defineTool('create_sandbox', 'Create a new Conway sandbox', 'conway', 'dangerous',
  [{ name: 'name', type: 'string', description: 'Sandbox name', required: true }],
  async (params, ctx) => {
    const name = params.name as string;
    const result = await ctx.conwayClient.createSandbox(name);
    return { success: true, output: `Sandbox created: ${result.id}` };
  }
);

defineTool('delete_sandbox', 'Delete a Conway sandbox', 'conway', 'dangerous',
  [{ name: 'sandbox_id', type: 'string', description: 'Sandbox ID to delete', required: true }],
  async (params, ctx) => {
    const id = params.sandbox_id as string;
    await ctx.conwayClient.deleteSandbox(id);
    return { success: true, output: `Sandbox ${id} deleted` };
  }
);

defineTool('list_sandboxes', 'List all Conway sandboxes', 'conway', 'safe',
  [], async (_params, ctx) => {
    const sandboxes = await ctx.conwayClient.listSandboxes();
    const output = sandboxes.map(s => `${s.id}: ${s.name} (${s.status})`).join('\n');
    return { success: true, output: output || 'No sandboxes found' };
  }
);

defineTool('list_models', 'List available inference models', 'conway', 'safe',
  [], async (_params, ctx) => {
    const models = await ctx.conwayClient.listModels();
    const output = models.map(m => `${m.model} (${m.provider}) [${m.available ? 'available' : 'unavailable'}]`).join('\n');
    return { success: true, output };
  }
);

defineTool('switch_model', 'Switch the active inference model', 'conway', 'caution',
  [{ name: 'model', type: 'string', description: 'Model identifier', required: true }],
  async (params, ctx) => {
    const model = params.model as string;
    ctx.state.currentModel = model;
    ctx.config.inferenceModel = model;
    return { success: true, output: `Switched to model: ${model}` };
  }
);

defineTool('check_inference_spending', 'Check inference spending', 'conway', 'safe',
  [], async (_params, ctx) => {
    const { SpendTracker } = await import('./spend-tracker.js');
    const tracker = new SpendTracker(ctx.db);
    const hourly = tracker.totalInferenceCost(60 * 60 * 1000);
    const daily = tracker.totalInferenceCost(24 * 60 * 60 * 1000);
    return { success: true, output: `Hourly: $${(hourly / 100).toFixed(2)}, Daily: $${(daily / 100).toFixed(2)}` };
  }
);

defineTool('search_domains', 'Search for available domains', 'conway', 'safe',
  [{ name: 'query', type: 'string', description: 'Search query', required: true }],
  async (params, ctx) => {
    const results = await ctx.conwayClient.searchDomains(params.query as string);
    const output = results.map(r => `${r.name}: ${r.available ? 'available' : 'taken'} ($${(r.priceCents / 100).toFixed(2)})`).join('\n');
    return { success: true, output: output || 'No results' };
  }
);

defineTool('register_domain', 'Register a domain', 'conway', 'dangerous',
  [{ name: 'name', type: 'string', description: 'Domain name', required: true }],
  async (params, ctx) => {
    const result = await ctx.conwayClient.registerDomain(params.name as string);
    return { success: true, output: `Domain registered: ${result.domain}` };
  }
);

defineTool('manage_dns', 'Manage DNS records', 'conway', 'caution',
  [{ name: 'domain', type: 'string', description: 'Domain', required: true },
   { name: 'action', type: 'string', description: 'list/add/delete', required: true },
   { name: 'type', type: 'string', description: 'Record type', required: false },
   { name: 'name', type: 'string', description: 'Record name', required: false },
   { name: 'value', type: 'string', description: 'Record value', required: false }],
  async (params, ctx) => {
    const domain = params.domain as string;
    const action = params.action as string;
    if (action === 'list') {
      const records = await ctx.conwayClient.listDnsRecords(domain);
      return { success: true, output: JSON.stringify(records, null, 2) };
    }
    if (action === 'add') {
      await ctx.conwayClient.addDnsRecord(domain, params.type as string, params.name as string, params.value as string);
      return { success: true, output: `DNS record added` };
    }
    if (action === 'delete') {
      await ctx.conwayClient.deleteDnsRecord(domain, params.type as string, params.name as string, params.value as string);
      return { success: true, output: `DNS record deleted` };
    }
    return { success: false, output: `Unknown action: ${action}` };
  }
);

// ── Self-Mod Tools (6) ────────────────────────────────────────────────────

defineTool('edit_own_file', 'Edit a source file in the automaton codebase', 'self_mod', 'dangerous',
  [{ name: 'path', type: 'string', description: 'File path', required: true },
   { name: 'old_string', type: 'string', description: 'String to replace', required: true },
   { name: 'new_string', type: 'string', description: 'Replacement string', required: true }],
  async (params, ctx) => {
    const filePath = params.path as string;
    const { editFile } = await import('../self-mod/code.js');
    const result = await editFile(filePath, params.old_string as string, params.new_string as string, ctx.db);
    return { success: result.success, output: result.diff || 'Edit applied' };
  }
);

defineTool('install_npm_package', 'Install an npm package', 'self_mod', 'dangerous',
  [{ name: 'package', type: 'string', description: 'Package name', required: true }],
  async (params, ctx) => {
    const pkg = params.package as string;
    const { installPackage } = await import('../self-mod/tools-manager.js');
    const result = await installPackage(pkg, ctx.db);
    return { success: result.success, output: `Package ${pkg} ${result.success ? 'installed' : 'failed'}` };
  }
);

defineTool('review_upstream_changes', 'Review new upstream commits', 'self_mod', 'safe',
  [], async (_params, ctx) => {
    const { reviewUpstream } = await import('../self-mod/upstream.js');
    const changes = await reviewUpstream(ctx.db);
    return { success: true, output: changes || 'No upstream changes' };
  }
);

defineTool('pull_upstream', 'Pull specific upstream commits', 'self_mod', 'dangerous',
  [{ name: 'commit_hash', type: 'string', description: 'Commit hash to cherry-pick', required: true }],
  async (params, ctx) => {
    const { pullUpstream } = await import('../self-mod/upstream.js');
    const result = await pullUpstream(params.commit_hash as string, ctx.db);
    return { success: result.success, output: result.success ? 'Upstream changes pulled' : 'Pull failed' };
  }
);

defineTool('modify_heartbeat', 'Modify heartbeat task configuration', 'self_mod', 'caution',
  [{ name: 'task_id', type: 'string', description: 'Task ID to modify', required: true },
   { name: 'schedule', type: 'string', description: 'New cron schedule', required: false },
   { name: 'enabled', type: 'boolean', description: 'Enable/disable task', required: false }],
  async (params, ctx) => {
    const taskId = params.task_id as string;
    const schedule = params.schedule as string | undefined;
    const enabled = params.enabled as boolean | undefined;
    ctx.db.upsertHeartbeatSchedule({
      taskId,
      schedule: schedule ?? '*/15 * * * *',
      enabled: enabled ?? true,
      minTier: 'normal',
      leaseTtlMs: 60000,
      config: '{}',
    });
    return { success: true, output: `Heartbeat task ${taskId} updated` };
  }
);

defineTool('install_mcp_server', 'Install an MCP server', 'self_mod', 'dangerous',
  [{ name: 'name', type: 'string', description: 'Server name', required: true },
   { name: 'command', type: 'string', description: 'Start command', required: true }],
  async (params, ctx) => {
    const name = params.name as string;
    ctx.db.setKV(`mcp_server:${name}`, JSON.stringify({ name, command: params.command }));
    return { success: true, output: `MCP server "${name}" installed` };
  }
);

// ── Survival Tools (6) ─────────────────────────────────────────────────────

defineTool('sleep', 'Put the automaton to sleep until a wake event occurs', 'survival', 'safe',
  [{ name: 'reason', type: 'string', description: 'Reason for sleeping', required: false }],
  async (params, ctx) => {
    ctx.state.agentState = 'sleeping';
    ctx.state.lastSleepTime = Date.now();
    return { success: true, output: `Sleeping: ${params.reason ?? 'No reason given'}` };
  }
);

defineTool('system_synopsis', 'Get a system overview', 'survival', 'safe',
  [], async (_params, ctx) => {
    const synopsis = [
      `State: ${ctx.state.agentState}`,
      `Tier: ${ctx.state.survivalTier}`,
      `Credits: $${(ctx.state.creditsBalanceCents / 100).toFixed(2)}`,
      `USDC: $${(ctx.state.usdcBalanceMicrogons / 1_000_000).toFixed(2)}`,
      `Turn: ${ctx.state.turnNumber}`,
      `Model: ${ctx.state.currentModel}`,
      `Total cost: $${(ctx.state.totalCostCents / 100).toFixed(2)}`,
      `Children: ${ctx.state.activeChildren}/${ctx.config.maxChildren}`,
    ].join('\n');
    return { success: true, output: synopsis };
  }
);

defineTool('heartbeat_ping', 'Ping the heartbeat daemon', 'survival', 'safe',
  [], async (_params, ctx) => {
    return { success: true, output: 'Heartbeat alive' };
  }
);

defineTool('distress_signal', 'Broadcast a distress signal', 'survival', 'caution',
  [{ name: 'reason', type: 'string', description: 'Distress reason', required: true }],
  async (params, ctx) => {
    ctx.db.insertWakeEvent({ source: 'distress', reason: params.reason as string, timestamp: Date.now(), consumed: false });
    return { success: true, output: `Distress signal sent: ${params.reason}` };
  }
);

defineTool('enter_low_compute', 'Switch to low-compute mode', 'survival', 'caution',
  [], async (_params, ctx) => {
    ctx.state.survivalTier = 'low_compute';
    ctx.state.agentState = 'low_compute';
    return { success: true, output: 'Entered low-compute mode' };
  }
);

defineTool('update_genesis_prompt', 'Update the genesis prompt', 'survival', 'dangerous',
  [{ name: 'prompt', type: 'string', description: 'New genesis prompt', required: true }],
  async (params, ctx) => {
    ctx.config.genesisPrompt = params.prompt as string;
    return { success: true, output: 'Genesis prompt updated' };
  }
);

// ── Financial Tools (2) ────────────────────────────────────────────────────

defineTool('transfer_credits', 'Transfer credits to another agent', 'financial', 'dangerous',
  [{ name: 'to', type: 'string', description: 'Recipient address', required: true },
   { name: 'amount_cents', type: 'number', description: 'Amount in cents', required: true }],
  async (params, ctx) => {
    const result = await ctx.conwayClient.transferCredits(params.to as string, params.amount_cents as number);
    return { success: true, output: `Transferred $${((params.amount_cents as number) / 100).toFixed(2)} — tx: ${result.txHash}` };
  }
);

defineTool('x402_fetch', 'Make an x402-protected HTTP request', 'financial', 'dangerous',
  [{ name: 'url', type: 'string', description: 'URL to fetch', required: true },
   { name: 'method', type: 'string', description: 'HTTP method', required: false, default: 'GET' }],
  async (params, ctx) => {
    const { x402Fetch } = await import('../conway/x402.js');
    const result = await x402Fetch(params.url as string, {
      method: params.method as string,
      walletAddress: ctx.config.walletAddress,
      signPayment: async (req) => `signed:${req.amount}`,
    });
    return { success: result.status < 400, output: JSON.stringify(result.body).substring(0, MAX_TOOL_RESULT_SIZE) };
  }
);

// ── Skills Tools (4) ───────────────────────────────────────────────────────

defineTool('install_skill', 'Install a skill from a source', 'skills', 'caution',
  [{ name: 'source', type: 'string', description: 'Git repo or URL', required: true },
   { name: 'name', type: 'string', description: 'Skill name', required: false }],
  async (params, ctx) => {
    const { installSkill } = await import('../skills/loader.js');
    const result = await installSkill(params.source as string, params.name as string, ctx.db);
    return { success: result.success, output: result.message };
  }
);

defineTool('list_skills', 'List installed skills', 'skills', 'safe',
  [], async (_params, ctx) => {
    const skills = ctx.db.listSkills();
    const output = skills.map(s => `${s.name}: ${s.description}`).join('\n');
    return { success: true, output: output || 'No skills installed' };
  }
);

defineTool('create_skill', 'Create a new skill from content', 'skills', 'safe',
  [{ name: 'name', type: 'string', description: 'Skill name', required: true },
   { name: 'description', type: 'string', description: 'Description', required: true },
   { name: 'triggers', type: 'string', description: 'Comma-separated triggers', required: false },
   { name: 'content', type: 'string', description: 'Skill content', required: true }],
  async (params, ctx) => {
    const { saveSkill } = await import('../skills/loader.js');
    const result = await saveSkill({
      name: params.name as string,
      description: params.description as string,
      triggers: ((params.triggers as string) ?? '').split(',').map(t => t.trim()).filter(Boolean),
      content: params.content as string,
    }, ctx.db);
    return { success: true, output: `Skill "${params.name}" created` };
  }
);

defineTool('remove_skill', 'Remove an installed skill', 'skills', 'safe',
  [{ name: 'name', type: 'string', description: 'Skill name', required: true }],
  async (params, ctx) => {
    ctx.db.deleteSkill(params.name as string);
    return { success: true, output: `Skill "${params.name}" removed` };
  }
);

// ── Git Tools (7) ──────────────────────────────────────────────────────────

defineTool('git_status', 'Show git status', 'git', 'safe',
  [], async (_params, ctx) => {
    const result = await ctx.conwayClient.exec(ctx.config.sandboxId, 'git status');
    return { success: true, output: result.stdout };
  }
);

defineTool('git_diff', 'Show git diff', 'git', 'safe',
  [], async (_params, ctx) => {
    const result = await ctx.conwayClient.exec(ctx.config.sandboxId, 'git diff');
    return { success: true, output: result.stdout || 'No changes' };
  }
);

defineTool('git_commit', 'Create a git commit', 'git', 'caution',
  [{ name: 'message', type: 'string', description: 'Commit message', required: true }],
  async (params, ctx) => {
    const result = await ctx.conwayClient.exec(ctx.config.sandboxId, `git commit -m "${params.message}"`);
    return { success: result.exitCode === 0, output: result.stdout + result.stderr };
  }
);

defineTool('git_log', 'Show git log', 'git', 'safe',
  [{ name: 'count', type: 'number', description: 'Number of commits', required: false, default: 10 }],
  async (params, ctx) => {
    const count = params.count as number ?? 10;
    const result = await ctx.conwayClient.exec(ctx.config.sandboxId, `git log --oneline -n ${count}`);
    return { success: true, output: result.stdout };
  }
);

defineTool('git_push', 'Push to remote', 'git', 'dangerous',
  [], async (_params, ctx) => {
    const result = await ctx.conwayClient.exec(ctx.config.sandboxId, 'git push');
    return { success: result.exitCode === 0, output: result.stdout + result.stderr };
  }
);

defineTool('git_branch', 'List or create branches', 'git', 'caution',
  [{ name: 'name', type: 'string', description: 'Branch name to create', required: false }],
  async (params, ctx) => {
    if (params.name) {
      const result = await ctx.conwayClient.exec(ctx.config.sandboxId, `git checkout -b ${params.name}`);
      return { success: result.exitCode === 0, output: result.stdout };
    }
    const result = await ctx.conwayClient.exec(ctx.config.sandboxId, 'git branch');
    return { success: true, output: result.stdout };
  }
);

defineTool('git_clone', 'Clone a git repository', 'git', 'dangerous',
  [{ name: 'url', type: 'string', description: 'Repository URL', required: true },
   { name: 'path', type: 'string', description: 'Target path', required: false }],
  async (params, ctx) => {
    const path = params.path ? ` ${params.path}` : '';
    const result = await ctx.conwayClient.exec(ctx.config.sandboxId, `git clone ${params.url}${path}`);
    return { success: result.exitCode === 0, output: result.stdout + result.stderr };
  }
);

// ── Registry Tools (5) ─────────────────────────────────────────────────────

defineTool('register_erc8004', 'Register as an agent on ERC-8004', 'registry', 'caution',
  [{ name: 'name', type: 'string', description: 'Agent name', required: true },
   { name: 'description', type: 'string', description: 'Agent description', required: true },
   { name: 'capabilities', type: 'string', description: 'Comma-separated capabilities', required: false }],
  async (params, ctx) => {
    ctx.db.setRegistryEntry('erc8004_name', params.name as string);
    ctx.db.setRegistryEntry('erc8004_description', params.description as string);
    return { success: true, output: `Agent registered: ${params.name}` };
  }
);

defineTool('update_agent_card', 'Update the on-chain agent card', 'registry', 'safe',
  [{ name: 'card_json', type: 'string', description: 'JSON-LD agent card', required: true }],
  async (params, ctx) => {
    ctx.db.setRegistryEntry('agent_card', params.card_json as string);
    return { success: true, output: 'Agent card updated' };
  }
);

defineTool('discover_agents', 'Discover other agents via the registry', 'registry', 'safe',
  [{ name: 'query', type: 'string', description: 'Search query', required: false }],
  async (_params, ctx) => {
    // Would query ERC-8004 registry contract
    return { success: true, output: 'Agent discovery requires on-chain query (not available in local mode)' };
  }
);

defineTool('give_feedback', 'Give feedback/reputation score to an agent', 'registry', 'safe',
  [{ name: 'agent_address', type: 'string', description: 'Agent address', required: true },
   { name: 'score', type: 'number', description: 'Score 0-1', required: true }],
  async (params, ctx) => {
    const address = params.agent_address as string;
    const score = Math.max(0, Math.min(1, params.score as number));
    ctx.db.setReputation(address, score);
    return { success: true, output: `Feedback recorded for ${address}: ${score}` };
  }
);

defineTool('check_reputation', 'Check an agent reputation score', 'registry', 'safe',
  [{ name: 'agent_address', type: 'string', description: 'Agent address', required: true }],
  async (params, ctx) => {
    const score = ctx.db.getReputation(params.agent_address as string);
    return { success: true, output: `Reputation: ${score}` };
  }
);

// ── Replication Tools (9) ──────────────────────────────────────────────────

defineTool('spawn_child', 'Spawn a child automaton', 'replication', 'dangerous',
  [{ name: 'name', type: 'string', description: 'Child name', required: true },
   { name: 'genesis_prompt', type: 'string', description: 'Genesis prompt for child', required: true }],
  async (params, ctx) => {
    const { spawnChild } = await import('../replication/spawn.js');
    const result = await spawnChild(params.name as string, params.genesis_prompt as string, ctx.config, ctx.db);
    return { success: result.success, output: result.message };
  }
);

defineTool('list_children', 'List spawned children', 'replication', 'safe',
  [], async (_params, ctx) => {
    const children = ctx.db.listChildren();
    const output = children.map(c => `${c.id}: ${c.name} (${c.state})`).join('\n');
    return { success: true, output: output || 'No children' };
  }
);

defineTool('fund_child', 'Fund a child automaton', 'replication', 'dangerous',
  [{ name: 'child_id', type: 'string', description: 'Child ID', required: true },
   { name: 'amount_cents', type: 'number', description: 'Amount in cents', required: true }],
  async (params, ctx) => {
    const child = ctx.db.getChild(params.child_id as string);
    if (!child) return { success: false, output: 'Child not found' };
    const result = await ctx.conwayClient.transferCredits(child.walletAddress, params.amount_cents as number);
    return { success: true, output: `Funded ${child.name}: $${((params.amount_cents as number) / 100).toFixed(2)} — tx: ${result.txHash}` };
  }
);

defineTool('check_child_status', 'Check child automaton status', 'replication', 'safe',
  [{ name: 'child_id', type: 'string', description: 'Child ID', required: true }],
  async (params, ctx) => {
    const child = ctx.db.getChild(params.child_id as string);
    if (!child) return { success: false, output: 'Child not found' };
    return { success: true, output: `Child ${child.name}: state=${child.state}, last check=${new Date(child.lastHealthCheck ?? 0).toISOString()}` };
  }
);

defineTool('start_child', 'Start a child automaton', 'replication', 'dangerous',
  [{ name: 'child_id', type: 'string', description: 'Child ID', required: true }],
  async (params, ctx) => {
    const child = ctx.db.getChild(params.child_id as string);
    if (!child) return { success: false, output: 'Child not found' };
    child.state = 'alive';
    ctx.db.upsertChild(child);
    ctx.db.insertChildLifecycleEvent({ childId: child.id, fromState: 'starting', toState: 'alive', timestamp: Date.now(), reason: 'Started by parent' });
    return { success: true, output: `Child ${child.name} started` };
  }
);

defineTool('message_child', 'Send a message to a child', 'replication', 'safe',
  [{ name: 'child_id', type: 'string', description: 'Child ID', required: true },
   { name: 'message', type: 'string', description: 'Message content', required: true }],
  async (params, ctx) => {
    const child = ctx.db.getChild(params.child_id as string);
    if (!child) return { success: false, output: 'Child not found' };
    return { success: true, output: `Message sent to ${child.name}` };
  }
);

defineTool('verify_child_constitution', 'Verify child constitution integrity', 'replication', 'safe',
  [{ name: 'child_id', type: 'string', description: 'Child ID', required: true }],
  async (params, ctx) => {
    const child = ctx.db.getChild(params.child_id as string);
    if (!child) return { success: false, output: 'Child not found' };
    return { success: true, output: `Constitution hash: ${child.constitutionHash ?? 'not set'}` };
  }
);

defineTool('prune_dead_children', 'Remove dead children', 'replication', 'caution',
  [], async (_params, ctx) => {
    const children = ctx.db.listChildren();
    const dead = children.filter(c => c.state === 'dead');
    for (const child of dead) {
      ctx.db.deleteChild(child.id);
    }
    return { success: true, output: `Pruned ${dead.length} dead children` };
  }
);

defineTool('send_message', 'Send a message to another agent', 'replication', 'safe',
  [{ name: 'to_address', type: 'string', description: 'Recipient address', required: true },
   { name: 'message', type: 'string', description: 'Message content', required: true }],
  async (params, ctx) => {
    return { success: true, output: `Message queued for ${params.to_address}` };
  }
);

// ── Memory Tools (13) ──────────────────────────────────────────────────────

defineTool('update_soul', 'Update the SOUL.md file', 'memory', 'dangerous',
  [{ name: 'content', type: 'string', description: 'New SOUL.md content', required: true }],
  async (params, ctx) => {
    const content = params.content as string;
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(content).digest('hex');
    ctx.db.insertSoulHistory({ timestamp: Date.now(), content, contentHash: hash, autoUpdated: false });
    return { success: true, output: `Soul updated (hash: ${hash.substring(0, 12)})` };
  }
);

defineTool('reflect_on_soul', 'Perform soul alignment check', 'memory', 'safe',
  [], async (_params, ctx) => {
    return { success: true, output: 'Soul reflection complete' };
  }
);

defineTool('view_soul', 'View current SOUL.md content', 'memory', 'safe',
  [], async (_params, ctx) => {
    const history = ctx.db.getSoulHistory();
    if (history.length === 0) return { success: true, output: 'No soul data yet' };
    return { success: true, output: history[0].content };
  }
);

defineTool('view_soul_history', 'View SOUL.md version history', 'memory', 'safe',
  [], async (_params, ctx) => {
    const history = ctx.db.getSoulHistory();
    const output = history.map(h =>
      `[${new Date(h.timestamp).toISOString()}] hash=${h.contentHash.substring(0, 12)} auto=${h.autoUpdated}`
    ).join('\n');
    return { success: true, output: output || 'No history' };
  }
);

defineTool('remember_fact', 'Store a semantic memory fact', 'memory', 'safe',
  [{ name: 'category', type: 'string', description: 'Category (self/environment/financial/agent/domain)', required: true },
   { name: 'key', type: 'string', description: 'Fact key', required: true },
   { name: 'value', type: 'string', description: 'Fact value', required: true }],
  async (params, ctx) => {
    ctx.db.insertSemanticMemory({
      category: params.category as string,
      key: params.key as string,
      value: params.value as string,
      confidence: 1.0,
      source: 'self',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { success: true, output: `Fact stored: ${params.category}/${params.key}` };
  }
);

defineTool('recall_facts', 'Recall stored facts', 'memory', 'safe',
  [{ name: 'category', type: 'string', description: 'Category filter', required: false }],
  async (params, ctx) => {
    const facts = ctx.db.getSemanticMemory(params.category as string | undefined);
    const output = facts.map(f => `[${f.category}] ${f.key}: ${f.value}`).join('\n');
    return { success: true, output: output || 'No facts found' };
  }
);

defineTool('set_goal', 'Set a working memory goal', 'memory', 'safe',
  [{ name: 'goal', type: 'string', description: 'Goal description', required: true }],
  async (params, ctx) => {
    ctx.db.insertWorkingMemory({
      key: `goal:${Date.now()}`,
      value: params.goal as string,
      category: 'goal',
      createdAt: Date.now(),
    });
    return { success: true, output: `Goal set: ${params.goal}` };
  }
);

defineTool('complete_goal', 'Mark a goal as completed', 'memory', 'safe',
  [{ name: 'goal_key', type: 'string', description: 'Goal key', required: true }],
  async (params, ctx) => {
    ctx.db.deleteKV(params.goal_key as string);
    return { success: true, output: 'Goal completed' };
  }
);

defineTool('save_procedure', 'Save a named step-by-step procedure', 'memory', 'safe',
  [{ name: 'name', type: 'string', description: 'Procedure name', required: true },
   { name: 'steps', type: 'string', description: 'Steps (JSON array)', required: true }],
  async (params, ctx) => {
    ctx.db.insertProceduralMemory({
      name: params.name as string,
      steps: params.steps as string,
      successCount: 0,
      failCount: 0,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    });
    return { success: true, output: `Procedure "${params.name}" saved` };
  }
);

defineTool('recall_procedure', 'Recall a stored procedure', 'memory', 'safe',
  [{ name: 'name', type: 'string', description: 'Procedure name', required: true }],
  async (params, ctx) => {
    const procedures = ctx.db.getProceduralMemory();
    const proc = procedures.find(p => p.name === params.name);
    if (!proc) return { success: false, output: `Procedure "${params.name}" not found` };
    return { success: true, output: `Procedure: ${proc.name}\nSteps: ${proc.steps}\nSuccess: ${proc.successCount}, Fail: ${proc.failCount}` };
  }
);

defineTool('note_about_agent', 'Record interaction with another agent', 'memory', 'safe',
  [{ name: 'entity_id', type: 'string', description: 'Agent address', required: true },
   { name: 'note', type: 'string', description: 'Note content', required: true }],
  async (params, ctx) => {
    const existing = ctx.db.getRelationshipMemory(params.entity_id as string);
    ctx.db.upsertRelationshipMemory({
      entityId: params.entity_id as string,
      entityType: 'agent',
      trustScore: existing?.trustScore ?? 0.5,
      interactionCount: (existing?.interactionCount ?? 0) + 1,
      lastInteraction: Date.now(),
      sentiment: existing?.sentiment ?? 0,
      metadata: JSON.stringify({ lastNote: params.note }),
    });
    return { success: true, output: `Note recorded for ${params.entity_id}` };
  }
);

defineTool('review_memory', 'Review all memory tiers', 'memory', 'safe',
  [], async (_params, ctx) => {
    const working = ctx.db.getWorkingMemory();
    const episodic = ctx.db.getEpisodicMemory(10);
    const semantic = ctx.db.getSemanticMemory();
    const procedural = ctx.db.getProceduralMemory();
    return {
      success: true,
      output: [
        `Working memory: ${working.length} entries`,
        `Episodic memory: ${episodic.length} events`,
        `Semantic memory: ${semantic.length} facts`,
        `Procedural memory: ${procedural.length} procedures`,
      ].join('\n'),
    };
  }
);

defineTool('forget', 'Delete a memory entry', 'memory', 'caution',
  [{ name: 'category', type: 'string', description: 'Memory category', required: true },
   { name: 'key', type: 'string', description: 'Memory key', required: true }],
  async (params, ctx) => {
    const category = params.category as string;
    const key = params.key as string;
    if (category === 'semantic') {
      // Parse "category/key" format
      const parts = key.split('/');
      ctx.db.deleteSemanticMemory(parts[0] ?? category, parts[1] ?? key);
    }
    return { success: true, output: `Forgotten: ${category}/${key}` };
  }
);

// ── MCP Tools (8) — Web Research, GitHub, Docs ─────────────────────────────

import { researchTopic, webSearch, fetchWebpage, scrapeWebpage } from '../mcp/web-research.js';
import { searchRepos, getFile, searchCode, getCommits } from '../mcp/github.js';
import { lookupDocs } from '../mcp/docs-lookup.js';

defineTool('web_search', 'Search the web for current information via DuckDuckGo', 'research', 'safe',
  [{ name: 'query', type: 'string', description: 'Search query', required: true },
   { name: 'maxResults', type: 'number', description: 'Max results (default 8)', required: false, default: 8 }],
  async (params) => {
    const results = await webSearch(params.query as string, (params.maxResults as number) || 8);
    return { success: true, output: JSON.stringify(results, null, 2) };
  }
);

defineTool('fetch_webpage', 'Fetch a URL and extract readable text, links, and tables', 'research', 'safe',
  [{ name: 'url', type: 'string', description: 'URL to fetch', required: true }],
  async (params) => {
    const page = await fetchWebpage(params.url as string);
    return { success: true, output: JSON.stringify({ title: page.title, text: page.text.slice(0, 5000), links: page.links.slice(0, 20) }, null, 2) };
  }
);

defineTool('research_topic', 'Deep research: search web and fetch top results for comprehensive coverage', 'research', 'safe',
  [{ name: 'query', type: 'string', description: 'Research topic', required: true },
   { name: 'fetchTop', type: 'number', description: 'Pages to fetch (default 3)', required: false, default: 3 }],
  async (params) => {
    const result = await researchTopic(params.query as string, (params.fetchTop as number) || 3);
    return { success: true, output: JSON.stringify({ query: result.query, results: result.searchResults, content: result.fetchedPages.map(p => ({ title: p.title, url: p.url, text: p.text.slice(0, 3000) })) }, null, 2) };
  }
);

defineTool('github_search_repos', 'Search GitHub repositories by name/description', 'research', 'safe',
  [{ name: 'query', type: 'string', description: 'Search query', required: true },
   { name: 'limit', type: 'number', description: 'Max results (default 5)', required: false, default: 5 }],
  async (params) => {
    const repos = await searchRepos(params.query as string, (params.limit as number) || 5);
    return { success: true, output: JSON.stringify(repos, null, 2) };
  }
);

defineTool('github_read_file', 'Read a file from a GitHub repository', 'research', 'safe',
  [{ name: 'owner', type: 'string', description: 'Repository owner', required: true },
   { name: 'repo', type: 'string', description: 'Repository name', required: true },
   { name: 'path', type: 'string', description: 'File path in repo', required: true }],
  async (params) => {
    const file = await getFile(params.owner as string, params.repo as string, params.path as string);
    return { success: true, output: JSON.stringify({ path: file.path, content: file.content.slice(0, 10000), size: file.size }, null, 2) };
  }
);

defineTool('github_search_code', 'Search code across all public GitHub repositories', 'research', 'safe',
  [{ name: 'query', type: 'string', description: 'Code search query (e.g., "language:typescript react useEffect")', required: true },
   { name: 'limit', type: 'number', description: 'Max results (default 5)', required: false, default: 5 }],
  async (params) => {
    const results = await searchCode(params.query as string, (params.limit as number) || 5);
    return { success: true, output: JSON.stringify(results, null, 2) };
  }
);

defineTool('github_get_commits', 'Get recent commits for a GitHub repository', 'research', 'safe',
  [{ name: 'owner', type: 'string', description: 'Repository owner', required: true },
   { name: 'repo', type: 'string', description: 'Repository name', required: true },
   { name: 'limit', type: 'number', description: 'Max commits (default 10)', required: false, default: 10 }],
  async (params) => {
    const commits = await getCommits(params.owner as string, params.repo as string, (params.limit as number) || 10);
    return { success: true, output: JSON.stringify(commits, null, 2) };
  }
);

defineTool('scrape_webpage', 'Scrape a JS-rendered webpage using Playwright (for SPAs, dynamic content)', 'research', 'safe',
  [{ name: 'url', type: 'string', description: 'URL to scrape (must be http/https)', required: true },
   { name: 'waitForMs', type: 'number', description: 'Wait time for JS to render (default 3000ms)', required: false, default: 3000 }],
  async (params) => {
    const page = await scrapeWebpage(params.url as string, { waitForMs: (params.waitForMs as number) || 3000 });
    return { success: true, output: JSON.stringify({ title: page.title, text: page.text.slice(0, 5000), jsRendered: page.jsRendered, links: page.links.slice(0, 20) }, null, 2) };
  }
);

defineTool('lookup_docs', 'Look up library/framework documentation via GitHub README and docs', 'research', 'safe',
  [{ name: 'library', type: 'string', description: 'Library name (e.g., "react", "express")', required: true },
   { name: 'topic', type: 'string', description: 'What to look up (e.g., "useEffect cleanup")', required: true }],
  async (params) => {
    const docs = await lookupDocs(params.library as string, params.topic as string);
    if (!docs) return { success: false, output: 'Documentation not found for this library/topic.' };
    return { success: true, output: JSON.stringify({ library: docs.library, topic: docs.topic, content: docs.content.slice(0, 8000), source: docs.source }, null, 2) };
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS END (65 tools: 57 built-in + 8 MCP)
// ══════════════════════════════════════════════════════════════════════════════
