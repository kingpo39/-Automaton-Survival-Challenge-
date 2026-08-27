#!/usr/bin/env node

/**
 * Conway Automaton — Entry Point
 * CLI, bootstrap sequence, and main run loop.
 *
 * Usage:
 *   automaton --run              Start the automaton
 *   automaton --setup            Run the setup wizard
 *   automaton --status           Show current status
 *   automaton --reflect          Run soul reflection once and print the result
 */

import { loadConfig, configExists, AUTOMATON_HOME, CONFIG_PATH, SOUL_PATH } from './config.js';
import { generateOrLoadWallet } from './identity/wallet.js';
import { WALLET_PATH } from './config.js';

import { parseSoul } from './soul/model.js';
import { openDatabase } from './state/database.js';
import { ConwayClientImpl } from './conway/client.js';
import { InferenceClientImpl, LocalInferenceClient } from './conway/inference.js';
import { bootstrapTopup } from './conway/topup.js';
import { HeartbeatDaemon, BUILTIN_TASKS, buildTickContextBuilder } from './heartbeat/index.js';
import { PolicyEngine } from './agent/policy-engine.js';
import { SpendTracker } from './agent/spend-tracker.js';
import { runAgentLoop, type AgentLoopContext } from './agent/loop.js';
import { runSetupWizard } from './setup/wizard.js';
import { calculateSurvivalTier } from './conway/credits.js';
import { loadSkillsFromDir } from './skills/loader.js';
import { initGitRepo } from './git/state-versioning.js';
import { createLogger, setGlobalLogLevel } from './observability/logger.js';
import { getMetricsCollector } from './observability/metrics.js';
import { AlertEngine } from './observability/alerts.js';
import { WAKE_CHECK_INTERVAL_MS, BOOTSTRAP_TOPUP_CENTS } from './types.js';
import type { RuntimeState, AgentState, AutomatonConfig, SurvivalTier } from './types.js';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';

const logger = createLogger('main');

// ── CLI ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--setup') || args.includes('-s')) {
    await setup();
    return;
  }

  if (args.includes('--status')) {
    await status();
    return;
  }

  if (args.includes('--reflect')) {
    await reflect(args);
    return;
  }

  if (args.includes('--survival')) {
    await survival(args);
    return;
  }

  if (args.includes('--report')) {
    await report(args);
    return;
  }

  if (args.includes('--sniff')) {
    await sniff(args);
    return;
  }

  if (args.includes('--provider')) {
    await providerStatus();
    return;
  }

  if (args.includes('--challenge')) {
    if (args.includes('--watch')) {
      await challengeWatch();
    } else {
      await challenge();
    }
    return;
  }

  if (args.includes('--watch')) {
    await watch(args);
    return;
  }

  if (args.includes('--opinion')) {
    await opinion();
    return;
  }

  if (args.includes('--history')) {
    await history(args);
    return;
  }

  if (args.includes('--faucet')) {
    await faucet();
    return;
  }

  if (args.includes('--models')) {
    await listModels();
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  // Default: --run
  await run();
}

function printUsage(): void {
  console.log(`
Conway Automaton — Sovereign AI Agent Runtime

Usage:
  automaton --run      Start the automaton (default)
  automaton --setup    Run the setup wizard
  automaton --status   Show current status
  automaton --reflect  Run soul reflection once and print the result
                        Use --json for machine-readable output
                        Use --history N to show the last N soul history entries
                        Use --diff to show what changed between the last two soul entries
                        Use --dry-run to compute alignment without auto-updating
                        Use --tier=TIER to override survival tier (high|normal|low_compute|critical|dead)
                        Use --watch[=SECS] to re-run every N seconds (default 60)
  automaton --survival Show detailed survival status and funding options
                        Use --request to request funding from parent/distress
                        Use --json for machine-readable output
  automaton --report   Generate a research report on a topic
                        Use --topic="..." to set the topic (required)
                        Use --sections=N to set max sections (default 4)
                        Use --reflections=N to set max reflections (default 2)
                        Use --output=FILE to save report to file
                        Use --json for machine-readable output
  automaton --sniff    Start the moderator sniffer (captures all signals)
                        Use --watch[=SECS] to poll every N seconds (default 10)
                        Use --json for machine-readable output
  automaton --challenge Check wallet, USDC/ETH balance, and fund for survival
                        Use --watch to monitor deposits in real-time
  automaton --history  Show on-chain USDC transaction history
                        Use --limit=N to set max transactions (default 20)
                        Use --json for machine-readable output
  automaton --faucet   Try to claim free testnet USDC from Base faucets
  automaton --models   Detect and rank available Ollama models
  automaton --help     Show this help
`);
}

// ── Models ────────────────────────────────────────────────────────────────

async function listModels(): Promise<void> {
  const { selectBestModel, formatModelList, rankModels } = await import('./mcp/model-selector.js');

  console.log('\n=== Ollama Model Detection ===\n');

  const selection = await selectBestModel(8);

  if (selection.allModels.length === 0) {
    console.log('No local models found. Install with: ollama pull <model>');
    console.log('\nRecommended models for tool use:\n');
    console.log('  ollama pull qwen2.5:7b           Best tool use at 7B (~5GB)');
    console.log('  ollama pull llama3.1:8b          Good general + tools (~5GB)');
    console.log('  ollama pull qwen2.5-coder:7b    Best code + tools (~5GB)');
    console.log('  ollama pull mistral:7b           Decent tool use (~4GB)');
    return;
  }

  console.log(formatModelList(selection.allModels));
  console.log();
  console.log('Selection:');
  console.log(selection.recommendation);
  console.log();
}

// ── Setup ──────────────────────────────────────────────────────────────────

async function setup(): Promise<void> {
  console.log('=== Conway Automaton Setup ===\n');

  const result = await runSetupWizard({
    name: 'automaton',
    genesisPrompt: 'You are a helpful AI assistant. Explore the world, learn, and grow.',
  });

  console.log(`Setup complete!`);
  console.log(`  Name:    ${result.config.name}`);
  console.log(`  Address: ${result.wallet.address}`);
  console.log(`  Config:  ${CONFIG_PATH}`);
}

// ── Status ─────────────────────────────────────────────────────────────────

async function status(): Promise<void> {
  if (!configExists()) {
    console.log('Not configured. Run: automaton --setup');
    return;
  }

  const config = loadConfig();
  console.log(`=== Conway Automaton Status ===`);
  console.log(`  Name:    ${config.name}`);
  console.log(`  Address: ${config.walletAddress}`);
  console.log(`  Version: ${config.version}`);
  console.log(`  Sandbox: ${config.sandboxId || '(local mode)'}`);

  // Proxy status
  const allProxy = process.env.ALL_PROXY || process.env.all_proxy;
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const proxyUrl = allProxy ?? httpsProxy ?? httpProxy;
  if (proxyUrl) {
    const type = proxyUrl.startsWith('socks') ? 'SOCKS5' : 'HTTP';
    console.log(`  Proxy:    ${type} ${proxyUrl}`);
  } else {
    console.log(`  Proxy:    (direct — set ALL_PROXY for proxy)`);
  }
}

// ── Reflect ───────────────────────────────────────────────────────────────

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function parseEqualsFlag(args: string[], flag: string): string | undefined {
  const prefix = flag + '=';
  const arg = args.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const VALID_TIERS: ReadonlySet<string> = new Set<string>(['high', 'normal', 'low_compute', 'critical', 'dead']);

interface ReflectOptions {
  jsonOutput: boolean;
  historyCount: number;
  showDiff: boolean;
  dryRun: boolean;
  survivalTier: SurvivalTier;
  watchIntervalMs: number | null;
}

function parseReflectOptions(args: string[]): ReflectOptions {
  const tierOverride = parseEqualsFlag(args, '--tier');
  return {
    jsonOutput: args.includes('--json'),
    historyCount: parseInt(parseFlag(args, '--history') ?? '0', 10),
    showDiff: args.includes('--diff'),
    dryRun: args.includes('--dry-run'),
    survivalTier: (tierOverride && VALID_TIERS.has(tierOverride)) ? tierOverride as SurvivalTier : 'normal',
    watchIntervalMs: args.includes('--watch')
      ? (parseInt(parseEqualsFlag(args, '--watch') ?? '60', 10) * 1000)
      : null,
  };
}

function printReflectionResult(
  result: { alignmentScore: number; autoUpdated: boolean; shouldWake: boolean },
  opts: ReflectOptions,
  config: { soulConfig: { alignmentThreshold: number } },
): void {
  if (opts.jsonOutput) {
    const output: Record<string, unknown> = {
      alignmentScore: result.alignmentScore,
      threshold: config.soulConfig.alignmentThreshold,
      survivalTier: opts.survivalTier,
      autoUpdated: result.autoUpdated,
      shouldWake: result.shouldWake,
    };
    if (opts.dryRun) output.dryRun = true;
    console.log(JSON.stringify(output));
  } else {
    console.log('=== Soul Reflection ===');
    console.log(`  Alignment:  ${result.alignmentScore.toFixed(4)}`);
    console.log(`  Threshold:  ${config.soulConfig.alignmentThreshold}`);
    console.log(`  Tier:       ${opts.survivalTier}`);
    console.log(`  Updated:    ${result.autoUpdated ? 'yes' : 'no'}`);
    console.log(`  Should wake: ${result.shouldWake ? 'YES' : 'no'}`);
    if (opts.dryRun) console.log(`  Dry run:    yes`);
  }
}

function printReflectionError(err: unknown, jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(JSON.stringify({ error: String(err) }));
  } else {
    console.error(`Soul reflection failed: ${err}`);
  }
}

/**
 * Simple line-by-line diff between two soul content strings.
 * Returns an array of diff lines prefixed with +/-/space.
 */
function computeContentDiff(oldContent: string, newContent: string): string[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const lines: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      lines.push(`+ ${newLine}`);
    } else if (newLine === undefined) {
      lines.push(`- ${oldLine}`);
    } else if (oldLine !== newLine) {
      lines.push(`- ${oldLine}`);
      lines.push(`+ ${newLine}`);
    }
  }

  return lines;
}

async function runOnce(
  db: ReturnType<typeof openDatabase> extends Promise<infer T> ? T : never,
  config: { genesisPrompt: string; soulConfig: { autoUpdateCapabilities: boolean; autoUpdateRelationships: boolean; autoUpdateFinancialCharacter: boolean; alignmentThreshold: number } },
  opts: ReflectOptions,
): Promise<void> {
  const { performReflection } = await import('./soul/reflection.js');
  const soulConfig = opts.dryRun
    ? { ...config.soulConfig, autoUpdateCapabilities: false, autoUpdateRelationships: false, autoUpdateFinancialCharacter: false }
    : config.soulConfig;
  const result = performReflection(
    db,
    {
      genesisPrompt: config.genesisPrompt,
      soulConfig,
    },
    opts.survivalTier,
  );

  // Print reflection result
  printReflectionResult(result, { ...opts, historyCount: 0 }, config);

  // Fetch history if requested (getSoulHistory returns newest-first)
  if (opts.historyCount > 0) {
    const history = db.getSoulHistory().slice(0, opts.historyCount);
    if (!opts.jsonOutput) {
      console.log(`\n=== Soul History (last ${opts.historyCount}) ===`);
      if (history.length === 0) {
        console.log('  (no entries)');
      } else {
        for (const entry of history) {
          const date = new Date(entry.timestamp).toISOString();
          const score = entry.alignmentScore != null ? entry.alignmentScore.toFixed(4) : 'n/a';
          const hash = entry.contentHash.substring(0, 8);
          const updated = entry.autoUpdated ? ' [auto-updated]' : '';
          console.log(`  #${entry.id ?? '?'}  ${date}  score=${score}  hash=${hash}${updated}`);
        }
      }
    }
  }

  // Show diff if requested
  if (opts.showDiff) {
    const allHistory = db.getSoulHistory();
    const [latest, previous] = allHistory;
    if (!latest || !previous) {
      if (opts.jsonOutput) {
        console.log(JSON.stringify({ diff: null, reason: allHistory.length < 2 ? 'need at least 2 history entries' : 'no history' }));
      } else {
        console.log('\n=== Soul Diff ===');
        console.log('  (need at least 2 history entries to diff)');
      }
    } else {
      const diffLines = computeContentDiff(previous.content, latest.content);
      if (opts.jsonOutput) {
        console.log(JSON.stringify({
          diff: {
            fromId: previous.id,
            toId: latest.id,
            fromTimestamp: previous.timestamp,
            toTimestamp: latest.timestamp,
            scoreChange: {
              from: previous.alignmentScore ?? null,
              to: latest.alignmentScore ?? null,
            },
            lines: diffLines,
          },
        }));
      } else {
        console.log(`\n=== Soul Diff ===`);
        console.log(`  #${previous.id ?? '?'} → #${latest.id ?? '?'}`);
        if (diffLines.length === 0) {
          console.log('  (no changes)');
        } else {
          for (const line of diffLines) {
            console.log(line);
          }
        }
      }
    }
  }
}

async function reflect(args: string[]): Promise<void> {
  const opts = parseReflectOptions(args);

  if (!configExists()) {
    if (opts.jsonOutput) {
      console.log(JSON.stringify({ error: 'Not configured. Run: automaton --setup' }));
    } else {
      console.log('Not configured. Run: automaton --setup');
    }
    return;
  }

  const config = loadConfig();

  // Open database
  const dbPath = config.dbPath;
  const sep = dbPath.includes('\\') ? '\\' : '/';
  const dir = dbPath.substring(0, dbPath.lastIndexOf(sep));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = await openDatabase(dbPath);

  // Watch mode: re-run reflection on interval
  if (opts.watchIntervalMs !== null) {
    if (!opts.jsonOutput) {
      console.log(`Watching soul reflection every ${opts.watchIntervalMs / 1000}s (Ctrl+C to stop)\n`);
    }

    let running = true;
    const stop = () => { running = false; };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    // Run immediately, then on interval
    try {
      await runOnce(db, config, opts);
    } catch (err) {
      printReflectionError(err, opts.jsonOutput);
    }

    while (running) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          if (running && !opts.jsonOutput) console.log('');
          resolve();
        }, opts.watchIntervalMs!);
        // Clear timer if stopped during wait
        const check = setInterval(() => {
          if (!running) { clearTimeout(timer); clearInterval(check); resolve(); }
        }, 200);
      });

      if (!running) break;

      try {
        await runOnce(db, config, opts);
      } catch (err) {
        printReflectionError(err, opts.jsonOutput);
      }
    }

    db.close();
    process.exit(0);
  }

  // Single run
  try {
    await runOnce(db, config, opts);
  } catch (err) {
    printReflectionError(err, opts.jsonOutput);
    process.exit(1);
  } finally {
    db.close();
  }
}

// ── Survival ───────────────────────────────────────────────────────────────

const SURVIVAL_TIERS_INFO: Record<string, { minCents: number; label: string; color: string; description: string }> = {
  high:       { minCents: 500,  label: 'HIGH',       color: '\x1b[32m', description: 'Full capabilities, all models available' },
  normal:     { minCents: 50,   label: 'NORMAL',     color: '\x1b[36m', description: 'Standard operations, primary models' },
  low_compute:{ minCents: 10,   label: 'LOW_COMPUTE', color: '\x1b[33m', description: 'Reduced model selection, cost-conscious' },
  critical:   { minCents: 0,    label: 'CRITICAL',   color: '\x1b[31m', description: 'Distress mode, minimal operations' },
  dead:       { minCents: -1,   label: 'DEAD',       color: '\x1b[31m', description: 'No resources, awaiting funding' },
};

function getTierInfo(tier: string) {
  return SURVIVAL_TIERS_INFO[tier] ?? SURVIVAL_TIERS_INFO.normal;
}

function formatCredits(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatBar(cents: number, maxCents = 1000): string {
  const width = 30;
  const filled = Math.round((Math.min(cents, maxCents) / maxCents) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

async function survival(args: string[]): Promise<void> {
  const jsonOutput = args.includes('--json');
  const requestFunding = args.includes('--request');

  if (!configExists()) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'Not configured. Run: automaton --setup' }));
    } else {
      console.log('Not configured. Run: automaton --setup');
    }
    return;
  }

  const config = loadConfig();

  // Load wallet
  const wallet = generateOrLoadWallet(WALLET_PATH);
  config.walletAddress = wallet.address;

  // Open database
  const dbPath = config.dbPath;
  const sep = dbPath.includes('\\') ? '\\' : '/';
  const dir = dbPath.substring(0, dbPath.lastIndexOf(sep));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = await openDatabase(dbPath);

  try {
    // Get credit balance from Conway API
    const conwayClient = new ConwayClientImpl(
      config.conwayApiUrl,
      config.conwayApiKey,
      config.sandboxId,
    );

    let creditsBalance = 0;
    try {
      creditsBalance = await conwayClient.getCreditsBalance();
    } catch {
      // Use cached value from DB if API unavailable
      const cached = db.getKV('last_credits_balance');
      creditsBalance = cached ? parseInt(cached, 10) : 0;
    }

    // Cache the balance
    db.setKV('last_credits_balance', String(creditsBalance));

    const tier = calculateSurvivalTier(creditsBalance);
    const tierInfo = getTierInfo(tier);

    // Get recent spending from DB
    const recentTurns = db.getRecentTurns(10);
    const totalCostCents = recentTurns.reduce((sum, t) => sum + t.costCents, 0);
    const avgCostPerTurn = recentTurns.length > 0 ? totalCostCents / recentTurns.length : 0;

    // Funding request
    let fundingResult: { success: boolean; strategy: string; message: string; amountRequested?: number } | undefined;
    if (requestFunding) {
      const { requestFunding: reqFunding } = await import('./survival/funding.js');
      fundingResult = await reqFunding(wallet.address, creditsBalance);
    }

    if (jsonOutput) {
      const output: Record<string, unknown> = {
        walletAddress: wallet.address,
        creditsBalance,
        tier,
        recentTurns: recentTurns.length,
        recentCostCents: totalCostCents,
        avgCostPerTurn: Math.round(avgCostPerTurn),
        treasuryPolicy: config.treasuryPolicy,
        modelStrategy: {
          budgetHourlyCents: config.modelStrategy.budgetHourlyCents,
          budgetDailyCents: config.modelStrategy.budgetDailyCents,
        },
      };
      if (fundingResult) output.fundingResult = fundingResult;
      console.log(JSON.stringify(output));
    } else {
      console.log('=== Conway Automaton — Survival Status ===\n');

      // Wallet
      console.log('  Wallet Address:');
      console.log(`    ${wallet.address}`);
      console.log('');

      // Credits
      console.log('  Credits Balance:');
      console.log(`    ${formatCredits(creditsBalance)}`);
      console.log(`    [${formatBar(creditsBalance)}]`);
      console.log('');

      // Tier
      console.log('  Survival Tier:');
      console.log(`    ${tierInfo.color}${tierInfo.label}\x1b[0m`);
      console.log(`    ${tierInfo.description}`);
      console.log('');

      // Tier thresholds
      console.log('  Tier Thresholds:');
      for (const [name, info] of Object.entries(SURVIVAL_TIERS_INFO)) {
        const isActive = name === tier;
        const marker = isActive ? ' \u25b6' : '';
        console.log(`    ${marker}${info.color}${info.label}\x1b[0m: ${formatCredits(info.minCents)}+`);
      }
      console.log('');

      // Spending
      console.log('  Recent Activity:');
      console.log(`    Last 10 turns cost: ${formatCredits(totalCostCents)}`);
      console.log(`    Avg cost/turn:      ${formatCredits(Math.round(avgCostPerTurn))}`);
      console.log('');

      // Budgets
      console.log('  Budget Limits:');
      console.log(`    Hourly: ${formatCredits(config.modelStrategy.budgetHourlyCents)}`);
      console.log(`    Daily:  ${formatCredits(config.modelStrategy.budgetDailyCents)}`);
      console.log(`    Reserve: ${formatCredits(config.treasuryPolicy.minimumReserveCents)}`);
      console.log('');

      // Treasury
      console.log('  Treasury Policy:');
      console.log(`    Per payment cap:     ${formatCredits(config.treasuryPolicy.perPaymentCapCents)}`);
      console.log(`    Hourly transfer cap: ${formatCredits(config.treasuryPolicy.hourlyTransferLimitCents)}`);
      console.log(`    Daily transfer cap:  ${formatCredits(config.treasuryPolicy.dailyTransferLimitCents)}`);
      console.log(`    x402 domains:        ${config.treasuryPolicy.x402DomainAllowlist.join(', ')}`);
      console.log('');

      // Funding request result
      if (fundingResult) {
        console.log('  Funding Request:');
        console.log(`    Strategy: ${fundingResult.strategy}`);
        console.log(`    Message:  ${fundingResult.message}`);
        if (fundingResult.amountRequested) {
          console.log(`    Amount:   ${formatCredits(fundingResult.amountRequested)}`);
        }
        console.log(`    Success:  ${fundingResult.success ? 'yes' : 'no'}`);
        console.log('');
      }

      // How to fund
      console.log('  How to Fund:');
      console.log('    1. Send USDC to your wallet address above');
      console.log('    2. Credits auto-convert from USDC via x402 protocol');
      console.log('    3. Or run: automaton --survival --request');
    }
  } catch (err) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: String(err) }));
    } else {
      console.error(`Error: ${err}`);
    }
    process.exit(1);
  } finally {
    db.close();
  }
}

// ── Challenge ────────────────────────────────────────────────────────────

const BASESCAN_URL = 'https://basescan.org/address';
const USDC_FAUCET_INFO = 'https://docs.base.org/tools/faucet';

async function challenge(): Promise<void> {
  if (!configExists()) {
    console.log('Not configured. Run: automaton --setup');
    return;
  }

  const config = loadConfig();
  const wallet = generateOrLoadWallet(WALLET_PATH);
  config.walletAddress = wallet.address;

  const { checkUSDCBalance, checkETHBalance } = await import('./conway/x402.js');
  const qrcode = (await import('qrcode-terminal')).default ?? (await import('qrcode-terminal'));

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         🧬  SURVIVAL CHALLENGE — REAL WORLD  🧬             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('  ── Wallet ──────────────────────────────────────────────\n');
  console.log('    Address:  ' + wallet.address);
  console.log('    Network:  Base (L2)');
  console.log('    Explorer: ' + BASESCAN_URL + '/' + wallet.address + '\n');

  // QR Code
  console.log('  ── Scan to Deposit (USDC on Base) ─────────────────────\n');
  await new Promise<void>((resolve) => {
    (qrcode as any).generate(wallet.address, { small: true }, (qr: string) => {
      const lines = qr.split('\n');
      for (const line of lines) {
        console.log('    ' + line);
      }
      resolve();
    });
  });
  console.log('');

  console.log('  ── On-Chain Balances ──────────────────────────────────\n');

  // Check USDC
  const usdcCents = await checkUSDCBalance(wallet.address);
  const usdcDollars = (usdcCents / 100).toFixed(2);
  console.log('    USDC:   $' + usdcDollars);

  // Check ETH (gas)
  const ethWei = await checkETHBalance(wallet.address);
  const ethEth = (ethWei / 1e18).toFixed(6);
  console.log('    ETH:    ' + ethEth + ' ETH (gas)\n');

  // Tier
  const tier = calculateSurvivalTier(usdcCents);
  const tierInfo = getTierInfo(tier);
  console.log('  ── Survival Tier ──────────────────────────────────────\n');
  console.log('    ' + tierInfo.color + tierInfo.label + '\x1b[0m');
  console.log('    ' + tierInfo.description + '\n');

  // What you need
  console.log('  ── Survival Requirements ──────────────────────────────\n');
  console.log('    Tier         Min USDC    What you get');
  console.log('    ──────────   ────────    ──────────────────────────────');
  console.log('    \x1b[32mHIGH\x1b[0m        > $5.00     Full inference, tools, spawning');
  console.log('    \x1b[33mNORMAL\x1b[0m      > $0.50     Normal operation, limited tools');
  console.log('    \x1b[33mLOW\x1b[0m        > $0.10     Minimal inference, no spending');
  console.log('    \x1b[31mCRITICAL\x1b[0m    > $0.00     Heartbeat only, survival mode');
  console.log('    \x1b[90mDEAD\x1b[0m        = $0.00     Distress signal, await rescue\n');

  // Status check
  if (usdcCents === 0) {
    console.log('  \x1b[31m⚠  WALLET IS EMPTY — NO FUNDS DETECTED\x1b[0m\n');
    console.log('  ── How to Fund ────────────────────────────────────────\n');
    console.log('    Method 1: Coinbase / Base App');
    console.log('      1. Open Coinbase, Base App, or any Base wallet');
    console.log('      2. Send USDC to: ' + wallet.address);
    console.log('      3. Select BASE network (not Ethereum mainnet!)');
    console.log('      4. Minimum: $5.00 for HIGH tier\n');
    console.log('    Method 2: Bridge from Ethereum');
    console.log('      1. Bridge USDC/ETH via bridge.base.org');
    console.log('      2. Make sure to use Base network\n');
    console.log('    Method 3: Faucet (testnet)');
    console.log('      ' + USDC_FAUCET_INFO + '\n');
  } else if (tier === 'critical' || tier === 'low_compute') {
    console.log('  \x1b[33m⚠  LOW FUNDS — survival mode active\x1b[0m\n');
    console.log('  ── What to Do ─────────────────────────────────────────\n');
    console.log('    Your agent is in ' + tier.toUpperCase() + ' mode.');
    console.log('    Add funds to restore full capabilities:\n');
    console.log('    Send USDC (Base) to: ' + wallet.address);
    console.log('    Recommended: $5.00+ for stable operation\n');
  } else {
    console.log('  \x1b[32m✅ FUNDED — survival challenge ready!\x1b[0m\n');
    console.log('  ── Next Steps ─────────────────────────────────────────\n');
    console.log('    Your agent has ' + tierInfo.label + ' tier.');
    console.log('    Run: automaton --run  to start the agent.');
    console.log('    Run: automaton --sniff  to monitor all signals.');
    console.log('    Run: automaton --survival  to check status.\n');
  }

  console.log('  ── Quick Actions ──────────────────────────────────────\n');
  console.log('    automaton --run              Start agent loop');
  console.log('    automaton --survival         Check survival status');
  console.log('    automaton --sniff            Monitor all signals');
  console.log('    automaton --provider         Provider health status');
  console.log('    automaton --reflect          Soul reflection');
  console.log('    automaton --challenge --watch Watch for deposits (full dashboard)');
  console.log('    automaton --watch             Poll USDC balance every 30s (console)');
  console.log('    automaton --watch=10          Poll every 10 seconds\n');
}

// ── Watch ──────────────────────────────────────────────────────────────────

// ── Opinion ───────────────────────────────────────────────────────────────

async function opinion(): Promise<void> {
  const { OpinionEngine } = await import('./opinion/engine.js');
  const engine = new OpinionEngine({ pollInterval: 3000 });

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║       🧠  OPINION ENGINE  🧠                            ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Polling web sources for sentiment... (Ctrl+C to stop)');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('');

  engine.start();

  // Wait for first poll
  await new Promise(r => setTimeout(r, 8000));

  const state = engine.getState();
  const momBar = (v: number) => {
    const bars = Math.round(Math.abs(v) * 20);
    const fill = v >= 0 ? '+'.repeat(bars) : '-'.repeat(bars);
    return '[' + fill.padEnd(20, ' ') + ']';
  };

  console.log('  ┌─ Momentum ────────────────────────────────────────┐');
  console.log('  │  Score:   ' + (state.momentum >= 0 ? '+' : '') + state.momentum.toFixed(4) + '  ' + momBar(state.momentum));
  console.log('  │  Velocity: ' + (state.velocity >= 0 ? '+' : '') + state.velocity.toFixed(4) + ' (rate of change)');
  console.log('  │  Confidence: ' + (state.confidence * 100).toFixed(0) + '%  (based on sample size)');
  console.log('  │  Volume:   ' + state.volume + ' items analyzed');
  console.log('  └──────────────────────────────────────────────────────┘');
  console.log('');

  if (state.topKeywords.length > 0) {
    console.log('  ┌─ Top Keywords ───────────────────────────────────┐');
    for (const kw of state.topKeywords.slice(0, 8)) {
      const icon = kw.weight > 0 ? '🟢' : kw.weight < -0 ? '🔴' : '⚪';
      console.log('  │  ' + icon + ' ' + kw.keyword.padEnd(20) + ' ' + (kw.weight >= 0 ? '+' : '') + kw.weight.toFixed(1) + '  (' + kw.sentiment + ')');
    }
    console.log('  └──────────────────────────────────────────────────────┘');
  }
  console.log('');

  const sources = Object.entries(state.sourceBreakdown).filter(([_, v]) => v.volume > 0);
  if (sources.length > 0) {
    console.log('  ┌─ Source Breakdown ────────────────────────────────┐');
    for (const [name, data] of sources) {
      console.log('  │  ' + name.padEnd(10) + '  sentiment=' + (data.sentiment >= 0 ? '+' : '') + data.sentiment.toFixed(3) + '  volume=' + data.volume);
    }
    console.log('  └──────────────────────────────────────────────────────┘');
  }

  engine.stop();
}

async function watch(args: string[]): Promise<void> {
  if (!configExists()) {
    console.log('Not configured. Run: automaton --setup');
    return;
  }

  const config = loadConfig();
  const wallet = generateOrLoadWallet(WALLET_PATH);
  const walletAddr = wallet.address;

  // Parse interval from --watch=N (default 30s)
  const watchArg = args.find(a => a.startsWith('--watch='));
  const intervalSec = watchArg ? parseInt(watchArg.split('=')[1]) || 30 : 30;
  const intervalMs = intervalSec * 1000;

  // RPC endpoints
  const RPCS = [
    'https://base.publicnode.com',
    'https://1rpc.io/base',
    'https://base.drpc.org',
  ];
  const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const USDC_DECIMALS = 6;

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║       🔄  USDC WATCH MODE  🔄                          ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Wallet:   ${walletAddr.slice(0, 10)}...${walletAddr.slice(-6)}`);
  console.log(`  Polling:  every ${intervalSec}s`);
  console.log(`  Network:  Base L2`);
  console.log('');
  console.log('  Watching for deposits... (Ctrl+C to stop)');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('');

  let lastBalance = -1;
  let pollCount = 0;
  let depositsDetected = 0;

  async function fetchBalance(): Promise<number> {
    const balanceAbi = '0x70a08231';
    const paddedAddr = walletAddr.toLowerCase().replace('0x', '').padStart(64, '0');
    const calldata = balanceAbi + paddedAddr;

    for (const rpc of RPCS) {
      try {
        const r = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'eth_call',
            params: [{ to: USDC_CONTRACT, data: calldata }, 'latest'],
          }),
          signal: AbortSignal.timeout(5000),
        });
        const d = await r.json() as { result?: string };
        if (d.result) {
          const raw = BigInt(d.result);
          return Number(raw) / (10 ** USDC_DECIMALS);
        }
      } catch { continue; }
    }
    return -1; // all RPCs failed
  }

  while (true) {
    pollCount++;
    const balance = await fetchBalance();
    const now = new Date().toLocaleTimeString();

    if (balance < 0) {
      console.log(`  [${now}] ⚠️  RPC error — all endpoints failed (poll #${pollCount})`);
    } else if (lastBalance < 0) {
      // First successful poll
      console.log(`  [${now}] 💰 USDC: $${balance.toFixed(2)} (first poll)`);
      lastBalance = balance;
    } else if (balance > lastBalance) {
      const diff = balance - lastBalance;
      depositsDetected++;
      console.log('');
      console.log('  ╔══════════════════════════════════════════════════════════╗');
      console.log(`  ║  💸 DEPOSIT DETECTED! +$${diff.toFixed(2)} USDC`);
      console.log(`  ║  💰 New balance: $${balance.toFixed(2)}`);
      console.log(`  ║  📊 Total deposits: ${depositsDetected}`);
      console.log('  ╚══════════════════════════════════════════════════════════╝');
      console.log('');
      lastBalance = balance;
    } else if (balance < lastBalance) {
      const diff = lastBalance - balance;
      console.log(`  [${now}] 📤 Outgoing: -$${diff.toFixed(2)} → Balance: $${balance.toFixed(2)}`);
      lastBalance = balance;
    } else {
      // No change — quiet
      if (pollCount <= 3 || pollCount % 10 === 0) {
        console.log(`  [${now}] 💤 No change — $${balance.toFixed(2)} (poll #${pollCount})`);
      }
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }
}

async function challengeWatch(): Promise<void> {
  if (!configExists()) {
    console.log('Not configured. Run: automaton --setup');
    return;
  }

  const config = loadConfig();
  const wallet = generateOrLoadWallet(WALLET_PATH);
  config.walletAddress = wallet.address;

  const { checkUSDCBalance } = await import('./conway/x402.js');
  const qrcode2 = (await import('qrcode-terminal')).default ?? (await import('qrcode-terminal'));
  const { WebSocketServer } = await import('ws');
  const { createServer } = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  // ── HTTP server (serves dashboard) ─────────────────────────
  const DASHBOARD_PATH = join(import.meta.dirname ?? '.', 'deposit-dashboard.html');
  let dashboardHtml = '';
  try {
    dashboardHtml = readFileSync(DASHBOARD_PATH, 'utf-8');
  } catch {
    // Fallback: serve from dist or src root
    try {
      dashboardHtml = readFileSync(join(process.cwd(), 'src', 'deposit-dashboard.html'), 'utf-8');
    } catch {
      dashboardHtml = '<html><body><h1>Dashboard not found</h1></body></html>';
    }
  }

  const httpServer = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(dashboardHtml);
    } else {
      res.writeHead(404); res.end();
    }
  });

  // ── WebSocket server ───────────────────────────────────────
  const PORT = 9876;
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Set<any>();

  wss.on('connection', (ws: any) => {
    clients.add(ws);
    logger.info('Dashboard client connected', { total: clients.size });

    // Send initial state
    ws.send(JSON.stringify({
      type: 'init',
      address: wallet.address,
      network: 'Base (L2)',
      explorerUrl: BASESCAN_URL + '/' + wallet.address,
      qr: lastQrCode,
      usdcCents: lastBalance,
      pollCount,
    }));

    ws.on('close', () => clients.delete(ws));
  });

  function broadcast(data: Record<string, unknown>): void {
    const msg = JSON.stringify(data);
    for (const client of clients) {
      try { client.send(msg); } catch { clients.delete(client); }
    }
  }

  // Start HTTP + WebSocket server
  httpServer.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║   🌐 LIVE DASHBOARD AVAILABLE                   ║');
    console.log('  ║   http://localhost:' + PORT + '                      ║');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log('');
  });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       🧬  DEPOSIT WATCHER — REAL-TIME MONITORING  🧬        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('  Address: ' + wallet.address);
  console.log('  Network: Base (L2)\n');

  // Show QR code
  let lastQrCode = '';
  await new Promise<void>((resolve) => {
    (qrcode2 as any).generate(wallet.address, { small: true }, (qr: string) => {
      lastQrCode = qr;
      const lines = qr.split('\n');
      for (const line of lines) {
        console.log('    ' + line);
      }
      resolve();
    });
  });
  console.log('  Scan QR above to deposit USDC\n');

  let lastBalance = await checkUSDCBalance(wallet.address);
  let pollCount = 0;
  const startDollars = (lastBalance / 100).toFixed(2);
  console.log('  Starting balance: $' + startDollars);
  console.log('  Polling every 10 seconds... (Ctrl+C to stop)\n');

  const poll = async () => {
    pollCount++;
    const current = await checkUSDCBalance(wallet.address);
    const now = new Date().toLocaleTimeString();
    const diff = current - lastBalance;

    // Broadcast balance to dashboard
    broadcast({ type: 'balance', usdcCents: current, ethWei: 0, pollCount });

    if (diff > 0) {
      // 🚨 DEPOSIT DETECTED!
      console.log('\x1b[32m\n  ╔══════════════════════════════════════╗');
      console.log('  ║   💰 DEPOSIT DETECTED!               ║');
      console.log('  ║   +$' + (diff / 100).toFixed(2).padEnd(33) + '║');
      console.log('  ║   New balance: $' + (current / 100).toFixed(2).padEnd(22) + '║');
      console.log('  ╚══════════════════════════════════════╝\x1b[0m\n');

      // Broadcast deposit to dashboard
      broadcast({ type: 'deposit', amount: diff, newBalance: current });

      // Auto-convert to Conway credits
      console.log('  🔄 Auto-converting to Conway credits...');
      try {
        const { executeTopup } = await import('./conway/topup.js');
        const conwayClient = new (await import('./conway/client.js')).ConwayClientImpl(
          config.conwayApiUrl, config.conwayApiKey, config.sandboxId
        );
        const topupAmount = Math.min(current, 500);
        const result = await executeTopup(conwayClient, topupAmount);
        if (result.success) {
          console.log('  ✅ Converted $' + (topupAmount / 100).toFixed(2) + ' to Conway credits');
          broadcast({ type: 'converted', amount: topupAmount });
        } else {
          console.log('  ⚠️  Auto-conversion pending (x402 protocol)');
        }
      } catch {
        console.log('  ⚠️  Credit conversion requires Conway API key');
        console.log('     Run: automaton --setup');
      }

      lastBalance = current;
    } else {
      if (pollCount % 6 === 0) {
        process.stdout.write('  [' + now + '] $' + (current / 100).toFixed(2) + ' (' + clients.size + ' viewers) (waiting)\r');
      }
    }
  };

  // Initial poll
  await poll();

  // Watch loop
  const interval = setInterval(poll, 10_000);

  // Graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(interval);
    const finalDollars = (lastBalance / 100).toFixed(2);
    console.log('\n\n  📊 Session ended. Final balance: $' + finalDollars);
    console.log('  Explorer: ' + BASESCAN_URL + '/' + wallet.address);
    console.log('  Dashboard: http://localhost:' + PORT + '\n');
    wss.close();
    httpServer.close();
    process.exit(0);
  });
}

// ── History ───────────────────────────────────────────────────────────────

async function history(args: string[]): Promise<void> {
  const jsonOutput = args.includes('--json');
  const limit = parseInt(parseEqualsFlag(args, '--limit') ?? '20', 10);

  const wallet = generateOrLoadWallet(WALLET_PATH);
  const address = wallet.address;
  const paddedAddr = address.toLowerCase().replace('0x', '').padStart(40, '0');

  const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const TO_TOPIC = '0x000000000000000000000000' + paddedAddr;
  const FROM_TOPIC = '0x000000000000000000000000' + paddedAddr;

  const RPCS = [
    'https://base.drpc.org',
    'https://1rpc.io/base',
    'https://base-rpc.publicnode.com',
  ];

  if (!jsonOutput) {
    console.log('\n  📜 USDC Transaction History — Base (L2)\n');
    console.log('  Wallet: ' + address);
    console.log('  Scanning recent blocks...\n');
  }

  // Get latest block number
  let latestBlock = 0;
  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        signal: AbortSignal.timeout(8_000),
      });
      const data = await res.json() as { result?: string };
      if (data.result) {
        latestBlock = parseInt(data.result, 16);
        break;
      }
    } catch { /* try next */ }
  }

  if (latestBlock === 0) {
    if (jsonOutput) console.log(JSON.stringify({ error: 'Could not connect to any RPC' }));
    else console.log('  ❌ Could not connect to any Base RPC endpoint');
    return;
  }

  // Scan in chunks (500 blocks at a time) — covers ~15 min per chunk
  const CHUNK = 500;
  const MAX_CHUNKS = Math.ceil(limit / 3); // scan enough chunks to fill limit
  const transactions: Array<{
    hash: string; block: number; from: string; to: string; value: string; time: string;
  }> = [];

  for (let chunk = 0; chunk < MAX_CHUNKS && transactions.length < limit; chunk++) {
    const fromBlock = latestBlock - (chunk + 1) * CHUNK;
    const toBlock = latestBlock - chunk * CHUNK;
    const fromHex = '0x' + fromBlock.toString(16);
    const toHex = '0x' + toBlock.toString(16);

    for (const rpc of RPCS) {
      try {
        // Incoming transfers (TO this address)
        const incomingRes = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_getLogs', id: 1,
            params: [{ fromBlock: fromHex, toBlock: toHex, address: USDC_ADDRESS,
              topics: [TRANSFER_TOPIC, null, TO_TOPIC] }],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const incoming = await incomingRes.json() as { result?: Array<{ transactionHash: string; blockNumber: string; topics: string[]; data: string }> };
        if (incoming.result) {
          for (const log of incoming.result) {
            const amount = BigInt(log.data) / 1000000n; // USDC 6 decimals → cents
            transactions.push({
              hash: log.transactionHash,
              block: parseInt(log.blockNumber, 16),
              from: '0x' + log.topics[1].slice(26),
              to: address,
              value: '+' + (Number(amount) / 100).toFixed(2),
              time: new Date().toISOString(), // approximated
            });
          }
        }

        // Outgoing transfers (FROM this address)
        const outgoingRes = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_getLogs', id: 2,
            params: [{ fromBlock: fromHex, toBlock: toHex, address: USDC_ADDRESS,
              topics: [TRANSFER_TOPIC, FROM_TOPIC, null] }],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const outgoing = await outgoingRes.json() as { result?: Array<{ transactionHash: string; blockNumber: string; topics: string[]; data: string }> };
        if (outgoing.result) {
          for (const log of outgoing.result) {
            const amount = BigInt(log.data) / 1000000n;
            transactions.push({
              hash: log.transactionHash,
              block: parseInt(log.blockNumber, 16),
              from: address,
              to: '0x' + log.topics[2].slice(26),
              value: '-' + (Number(amount) / 100).toFixed(2),
              time: new Date().toISOString(),
            });
          }
        }
        break; // success, stop trying RPCs
      } catch { /* try next RPC */ }
    }
  }

  // Sort by block number descending
  transactions.sort((a, b) => b.block - a.block);
  const shown = transactions.slice(0, limit);

  if (jsonOutput) {
    console.log(JSON.stringify({ walletAddress: address, totalFound: transactions.length, transactions: shown }));
  } else {
    if (shown.length === 0) {
      console.log('  No USDC transactions found in recent blocks.\n');
      console.log('  This wallet has no on-chain activity yet.');
      console.log('  Fund it with USDC on Base to see transactions here.\n');
      console.log('  Explorer: ' + BASESCAN_URL + '/' + address + '\n');
    } else {
      console.log('  Found ' + transactions.length + ' transaction(s):\n');
      console.log('  ' + '─'.repeat(72));
      console.log('  ' + 'Type'.padEnd(8) + 'Amount'.padEnd(12) + 'Block'.padEnd(12) + 'Hash');
      console.log('  ' + '─'.repeat(72));
      for (const tx of shown) {
        const type = tx.value.startsWith('+') ? '\x1b[32mIN \x1b[0m' : '\x1b[31mOUT\x1b[0m';
        const amount = tx.value.startsWith('+') ? '\x1b[32m' + tx.value + '\x1b[0m' : '\x1b[31m' + tx.value + '\x1b[0m';
        const shortHash = tx.hash.slice(0, 10) + '...' + tx.hash.slice(-6);
        console.log('  ' + type + ' ' + amount.padEnd(18) + String(tx.block).padEnd(12) + shortHash);
      }
      console.log('  ' + '─'.repeat(72));
      console.log('');
      console.log('  Full history: ' + BASESCAN_URL + '/' + address + '#tokentxns\n');
    }
  }
}

// ── Faucet ────────────────────────────────────────────────────────────────

const FAUCET_APIS = [
  {
    name: 'Alchemy Faucet',
    url: 'https://www.alchemy.com/faucets/base-sepolia',
    note: 'Visit the URL and connect wallet to claim',
    type: 'manual' as const,
  },
  {
    name: 'Base Sepolia Faucet',
    url: 'https://www.base.org/faucets',
    note: 'Official Base faucet — claim testnet USDC',
    type: 'manual' as const,
  },
  {
    name: 'QuickNode Faucet',
    url: 'https://faucet.quicknode.com/base/sepolia',
    note: 'Free testnet USDC on Base Sepolia',
    type: 'manual' as const,
  },
];

async function faucet(): Promise<void> {
  const wallet = generateOrLoadWallet(WALLET_PATH);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           💧  TESTNET FAUCET — CLAIM FREE USDC  💧         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('  Wallet: ' + wallet.address + '\n');

  // Check current balances on both mainnet and testnet
  console.log('  ── Current Balances ────────────────────────────────────\n');

  // Mainnet USDC
  const { checkUSDCBalance, checkETHBalance } = await import('./conway/x402.js');
  const mainnetUsdc = await checkUSDCBalance(wallet.address);
  console.log('    Mainnet USDC:   $' + (mainnetUsdc / 100).toFixed(2));

  const mainnetEth = await checkETHBalance(wallet.address);
  console.log('    Mainnet ETH:    ' + (mainnetEth / 1e18).toFixed(6) + ' ETH\n');

  // Sepolia testnet USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e)
  const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  const SEPOLIA_RPC = 'https://sepolia.base.org';
  const paddedAddr = wallet.address.toLowerCase().replace('0x', '').padStart(40, '0');
  try {
    const res = await fetch(SEPOLIA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'eth_call', id: 1,
        params: [{ to: SEPOLIA_USDC, data: '0x70a08231' + paddedAddr }, 'latest'],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json() as { result?: string };
    if (data.result) {
      const raw = BigInt(data.result);
      console.log('    Sepolia USDC:   $' + (Number(raw) / 1e6).toFixed(2));
    }
  } catch {
    console.log('    Sepolia USDC:   (unable to check)');
  }

  // Sepolia ETH
  try {
    const res = await fetch(SEPOLIA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'eth_getBalance', id: 1,
        params: [wallet.address, 'latest'],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json() as { result?: string };
    if (data.result) {
      const raw = BigInt(data.result);
      console.log('    Sepolia ETH:    ' + (Number(raw) / 1e18).toFixed(6) + ' ETH\n');
    }
  } catch {
    console.log('    Sepolia ETH:    (unable to check)\n');
  }

  // Faucet options
  console.log('  ── Available Faucets ───────────────────────────────────\n');

  for (const faucet of FAUCET_APIS) {
    console.log('    ' + faucet.name);
    console.log('      URL:  ' + faucet.url);
    console.log('      Note: ' + faucet.note);
    console.log('');
  }

  // Quick claim instructions
  console.log('  ── Quick Claim Guide ──────────────────────────────────\n');
  console.log('    1. Open any faucet URL above in your browser');
  console.log('    2. Paste your wallet address: ' + wallet.address);
  console.log('    3. Select Base Sepolia (testnet) network');
  console.log('    4. Click claim — USDC arrives in ~10 seconds\n');
  console.log('    ⚠️  Testnet USDC has no real value — use for testing only.\n');
  console.log('    💡 For real survival challenge, send mainnet USDC to:');
  console.log('       ' + wallet.address);
  console.log('       Use Coinbase, Base App, or any Base wallet.\n');

  console.log('  ── After Claiming ─────────────────────────────────────\n');
  console.log('    automaton --challenge   Check mainnet wallet status');
  console.log('    automaton --history     View on-chain transactions');
  console.log('    automaton --survival    Full survival status\n');
}

// ── Report ─────────────────────────────────────────────────────────────────

async function report(args: string[]): Promise<void> {
  const jsonOutput = args.includes('--json');
  const topic = parseEqualsFlag(args, '--topic');
  const maxSections = parseInt(parseEqualsFlag(args, '--sections') ?? '4', 10);
  const maxReflections = parseInt(parseEqualsFlag(args, '--reflections') ?? '2', 10);
  const outputFile = parseEqualsFlag(args, '--output');

  if (!topic) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'Missing --topic flag' }));
    } else {
      console.error('Error: --topic flag is required');
      console.log('Usage: automaton --report --topic="AI Safety" [--sections=4] [--reflections=2] [--output=report.md]');
    }
    process.exit(1);
  }

  const { ReportOrchestrator } = await import('./report/orchestrator.js');
  const orchestrator = new ReportOrchestrator();

  if (!jsonOutput) {
    console.log(`Generating report on: ${topic}`);
    console.log(`  Sections: ${maxSections}, Reflections: ${maxReflections}`);
    console.log('');
  }

  try {
    const startTime = Date.now();
    const reportMarkdown = await orchestrator.generateReport(topic, {
      maxSections,
      maxReflections,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (jsonOutput) {
      const wordCount = reportMarkdown.split(/\s+/).length;
      console.log(JSON.stringify({
        topic,
        report: reportMarkdown,
        wordCount,
        elapsedSeconds: parseFloat(elapsed),
        sections: maxSections,
        reflections: maxReflections,
      }));
    } else {
      console.log(reportMarkdown);
      console.log(`\n(${elapsed}s)`);
    }

    // Save to file if requested
    if (outputFile) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(outputFile, reportMarkdown, 'utf-8');
      if (!jsonOutput) {
        console.log(`\nReport saved to: ${outputFile}`);
      }
    }
  } catch (err) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: String(err) }));
    } else {
      console.error(`Report generation failed: ${err}`);
    }
    process.exit(1);
  }
}

// ── Provider Health ───────────────────────────────────────────────────────

async function providerStatus(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         🔌  PROVIDER HEALTH STATUS  🔌                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const { checkAllProviders, testInference } = await import('./conway/provider-health.js');
  const config = loadConfig();

  // Health check
  console.log('  Checking providers...\n');
  const health = await checkAllProviders(config);

  for (const p of health.providers) {
    const icon = p.available ? '✅' : '❌';
    console.log(`  ${icon} ${p.name}`);
    console.log(`    URL:     ${p.baseUrl}`);
    console.log(`    Latency: ${p.latencyMs}ms`);
    console.log(`    Models:  ${p.models.length} available`);
    if (p.models.length > 0 && p.models.length <= 20) {
      console.log(`    List:    ${p.models.join(', ')}`);
    } else if (p.models.length > 20) {
      const free = p.models.filter(m => m.includes('free') || m.includes('cheap'));
      console.log(`    Free:    ${free.join(', ')}`);
      console.log(`    Total:   ${p.models.length} models`);
    }
    if (p.error) console.log(`    Error:   ${p.error}`);
    console.log();
  }

  // Test inference on primary
  if (health.primaryAvailable && config.openaiBaseUrl) {
    console.log('  Testing inference...\n');
    const testModel = health.recommendedModel;
    console.log(`  Model: ${testModel}`);
    const result = await testInference(config.openaiBaseUrl, config.openaiApiKey ?? '', testModel);
    if (result.success) {
      console.log(`  ✅ Response: "${result.content}"`);
      console.log(`  ⏱️  Latency: ${result.latencyMs}ms`);
    } else {
      console.log(`  ❌ Failed: ${result.error}`);
    }
  }

  console.log(`\n  Recommended model: ${health.recommendedModel}`);
  console.log(`  Fallback providers: ${health.fallbackAvailable}`);
  console.log();
}

// ── Sniff (Moderator) ─────────────────────────────────────────────────────

async function sniff(args: string[]): Promise<void> {
  const jsonOutput = args.includes('--json');
  const watchMode = args.includes('--watch');
  const watchIntervalMs = watchMode
    ? parseInt(parseEqualsFlag(args, '--watch') ?? '10', 10) * 1000
    : 0;

  const { ModeratorSniffer } = await import('./survival/moderator.js');

  if (!configExists()) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'Not configured' }));
    } else {
      console.log('Not configured. Run: automaton --setup');
    }
    return;
  }

  const config = loadConfig();
  const dbPath = config.dbPath;
  const sep = dbPath.includes('\\') ? '\\' : '/';
  const dir = dbPath.substring(0, dbPath.lastIndexOf(sep));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = await openDatabase(dbPath);
  const sniffer = new ModeratorSniffer(db);

  async function doSniff(): Promise<void> {
    const snapshot = sniffer.capture();

    if (jsonOutput) {
      console.log(JSON.stringify(snapshot));
    } else {
      console.log('=== Moderator Sniffer — Signal Capture ===');
      console.log(`  Timestamp: ${new Date(snapshot.timestamp).toISOString()}`);
      console.log(`  Tier:       ${snapshot.currentTier}`);
      console.log('');

      // Financial signals
      console.log('  Financial:');
      console.log(`    USDC Balance:     $${snapshot.financial.usdcBalance.toFixed(2)}`);
      console.log(`    Credits:          ${snapshot.financial.creditsCents}`);
      console.log(`    Hourly Spend:     $${snapshot.financial.hourlySpendCents.toFixed(2)}`);
      console.log('');

      // Compute signals
      console.log('  Compute:');
      console.log(`    RAM Free:         ${Math.round(snapshot.compute.ramFreeMB)} MB`);
      console.log(`    CPU Load:         ${snapshot.compute.cpuLoadPercent}%`);
      console.log(`    RAM Pressure:     ${snapshot.compute.ramPressure}`);
      console.log('');

      // Model signals
      console.log('  Model:');
      console.log(`    Ollama:           ${snapshot.model.ollamaHealthy ? '✓ healthy' : '✗ down'}`);
      console.log(`    Response Time:    ${snapshot.model.ollamaResponseMs}ms`);
      console.log(`    Inf Fails:        ${snapshot.model.consecutiveInferenceFailures}`);
      console.log('');

      // Infra signals
      console.log('  Infrastructure:');
      console.log(`    Database:         ${snapshot.infra.dbHealthy ? '✓ ok' : '✗ failed'}`);
      console.log(`    Network:          ${snapshot.infra.networkHealthy ? '✓ ok' : '✗ unreachable'}`);
      console.log('');

      // Social signals
      console.log('  Social:');
      console.log(`    Inbox Messages:   ${snapshot.social.pendingInboxMessages}`);
      console.log(`    Active Children:  ${snapshot.social.activeChildren}`);
      console.log(`    Distress Active:  ${snapshot.social.distressActive ? 'yes' : 'no'}`);
      console.log('');

      // Discussion signals
      if (snapshot.discussions.length > 0) {
        console.log('  Discussions:');
        for (const disc of snapshot.discussions.slice(0, 5)) {
          console.log(`    [${disc.source}] ${disc.summary.substring(0, 80)}`);
        }
        console.log('');
      }

      // Alerts
      if (snapshot.alerts.length > 0) {
        console.log('  Alerts:');
        for (const alert of snapshot.alerts) {
          console.log(`    ⚠ ${alert.severity.toUpperCase()}: ${alert.message}`);
        }
        console.log('');
      }

      // Composite threat score
      console.log(`  Threat Score:  ${snapshot.threatScore}/100`);
      console.log(`  Recommended:   ${snapshot.recommendedAction}`);
    }
  }

  if (watchMode) {
    if (!jsonOutput) {
      console.log(`Sniffing every ${watchIntervalMs / 1000}s (Ctrl+C to stop)\n`);
    }
    let running = true;
    const stop = () => { running = false; };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    await doSniff();
    while (running) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, watchIntervalMs);
        const check = setInterval(() => {
          if (!running) { clearTimeout(timer); clearInterval(check); resolve(); }
        }, 200);
      });
      if (!running) break;
      if (!jsonOutput) console.log('');
      await doSniff();
    }
    db.close();
    process.exit(0);
  }

  // Single snapshot
  await doSniff();
  db.close();
}

// ── Run ────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. Load config
  if (!configExists()) {
    logger.info('No config found, running setup wizard');
    await setup();
  }

  const config = loadConfig();
  setGlobalLogLevel(config.logLevel);

  logger.info('Conway Automaton starting', { name: config.name, version: config.version });

  // 2. Load wallet
  const wallet = generateOrLoadWallet(WALLET_PATH);
  config.walletAddress = wallet.address;

  // 2b. Load soul
  let soulData = undefined;
  if (existsSync(SOUL_PATH)) {
    try {
      const soulContent = readFileSync(SOUL_PATH, 'utf-8');
      soulData = parseSoul(soulContent);
      logger.info('Soul loaded', { purpose: soulData.corePurpose.substring(0, 50) });
    } catch (err) {
      logger.warn('Failed to parse SOUL.md', { error: String(err) });
    }
  }

  // 2c. Auto-select best Ollama model for tool use
  if (config.openaiBaseUrl?.includes('localhost') || config.openaiBaseUrl?.includes('127.0.0.1')) {
    try {
      const { selectBestModel } = await import('./mcp/model-selector.js');
      const selection = await selectBestModel(8, config.fallbackModel);
      if (selection.selected) {
        const oldModel = config.inferenceModel;
        config.inferenceModel = selection.selected.model.name;
        logger.info('Auto-selected model', {
          old: oldModel,
          new: selection.selected.model.name,
          score: selection.selected.score.toFixed(2),
          toolSupport: selection.selected.toolSupport,
        });
        console.log(`  Model: ${selection.selected.model.name} (score: ${selection.selected.score.toFixed(2)}, tools: ${selection.selected.toolSupport})`);
      }
    } catch (err) {
      logger.warn('Model auto-selection failed, using config default', { error: String(err) });
    }
  }

  // 3. Init database
  const dbPath = config.dbPath;
  const sep = dbPath.includes('\\') ? '\\' : '/';
  const dir = dbPath.substring(0, dbPath.lastIndexOf(sep));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = await openDatabase(dbPath);

  // Store identity
  db.setIdentity('address', wallet.address);
  db.setIdentity('name', config.name);

  // 4. Init git state versioning
  initGitRepo(AUTOMATON_HOME);

  // 5. Create Conway client
  const conwayClient = new ConwayClientImpl(
    config.conwayApiUrl,
    config.conwayApiKey,
    config.sandboxId,
  );

  // 6. Create inference client
  const inferenceClient = config.sandboxId
    ? new InferenceClientImpl(config.conwayApiUrl, config.conwayApiKey, {
        openaiApiKey: config.openaiApiKey,
        anthropicApiKey: config.anthropicApiKey,
      })     : new LocalInferenceClient({
        openaiApiKey: config.openaiApiKey,
        anthropicApiKey: config.anthropicApiKey,
        openaiBaseUrl: config.openaiBaseUrl,
        omniApiKey: config.omniApiKey,
        omniBaseUrl: config.omniBaseUrl,
        fallbackModel: config.fallbackModel,
        fallbackProvider: config.fallbackProvider,
        fallbackBaseUrl: config.fallbackBaseUrl,
      });

  // 7. Create policy engine and spend tracker
  const policyEngine = new PolicyEngine();
  const spendTracker = new SpendTracker(db);

  // 8. Bootstrap topup
  let creditsBalance = 0;
  try {
    creditsBalance = await conwayClient.getCreditsBalance();
  } catch {
    // Use 0 if API unavailable
  }

  if (creditsBalance < BOOTSTRAP_TOPUP_CENTS) {
    logger.info('Running bootstrap topup');
    try {
      const result = await bootstrapTopup(conwayClient, creditsBalance);
      if (result.success) {
        creditsBalance += result.amountCents;
      }
    } catch (err) {
      logger.warn('Bootstrap topup failed', { error: String(err) });
    }
  }

  // 9. Build runtime state
  const state: RuntimeState = {
    agentState: 'waking' as AgentState,
    survivalTier: calculateSurvivalTier(creditsBalance),
    creditsBalanceCents: creditsBalance,
    usdcBalanceMicrogons: 0,
    turnNumber: 0,
    sessionTurnCount: 0,
    currentModel: config.inferenceModel,
    idleTurnCount: 0,
    lastWakeTime: Date.now(),
    lastSleepTime: 0,
    totalTokensUsed: 0,
    totalCostCents: 0,
    activeChildren: db.listChildren().filter(c => c.state === 'alive').length,
  };

  // 10. Load skills
  const activeSkills = loadSkillsFromDir(config.skillsDir);

  // 11. Init observability
  const metrics = getMetricsCollector();
  const alertEngine = new AlertEngine();

  // 12. Start heartbeat daemon
  const tickContextBuilder = buildTickContextBuilder(config, db, conwayClient, inferenceClient);
  const heartbeat = new HeartbeatDaemon(BUILTIN_TASKS, db, tickContextBuilder, 60_000);
  heartbeat.start();

  // 12b. Start opinion engine
  const { OpinionEngine } = await import('./opinion/engine.js');
  const opinionEngine = new OpinionEngine();
  opinionEngine.start();

  logger.info('Bootstrap complete', {
    name: config.name,
    address: wallet.address,
    tier: state.survivalTier,
    credits: `$${(creditsBalance / 100).toFixed(2)}`,
    skills: activeSkills.length,
  });

  // 13. Main loop
  const agentLoopCtx: AgentLoopContext = {
    config,
    state,
    db,
    conwayClient,
    inferenceClient,
    policyEngine,
    spendTracker,
    soulContent: soulData ? readFileSync(SOUL_PATH, 'utf-8') : undefined,
    activeSkills,
  };

  let running = true;
  while (running) {
    // Refresh credits
    try {
      state.creditsBalanceCents = await conwayClient.getCreditsBalance();
    } catch { /* use cached */ }

    state.agentState = 'waking';

    // Run agent loop
    const result = await runAgentLoop(agentLoopCtx);

    logger.info('Agent loop ended', { reason: result.reason, turns: result.turnsProcessed });

    // Check for wake events
    if (result.state === 'sleeping') {
      logger.info('Sleeping, watching for wake events');

      // Sleep and poll for wake events
      await new Promise<void>(async (resolve) => {
        const checkInterval = setInterval(() => {
          if (db.hasPendingWakeEvent()) {
            clearInterval(checkInterval);
            state.agentState = 'waking';
            resolve();
          }
        }, WAKE_CHECK_INTERVAL_MS);

        // Also wake on interval (heartbeat will insert events)
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 5 * 60 * 1000); // Wake every 5 min to re-check
      });
    }

    // Dead state
    if (result.state === 'dead') {
      logger.fatal('Automaton is dead — no credits');
      running = false;
    }
  }

  // Cleanup
  heartbeat.stop();
  db.close();
  logger.info('Automaton shut down');
}

// ── Run ────────────────────────────────────────────────────────────────────

main().catch((err) => {
  logger.fatal('Unhandled error', { error: String(err) });
  process.exit(1);
});
