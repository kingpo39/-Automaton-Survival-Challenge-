/**
 * Conway Automaton — Soul Reflection
 * Periodic alignment check between soul and genesis prompt.
 * Auto-updates capabilities, relationships, and financial character.
 */

import type { AutomatonDatabase, SoulData, SurvivalTier } from '../types.js';
import { parseSoul, serializeSoul, soulHash } from './model.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('soul:reflection');

/**
 * Compute alignment between soul and genesis prompt using
 * Jaccard similarity + recall.
 */
export function computeAlignment(soulContent: string, genesisPrompt: string): number {
  const soulWords = new Set(soulContent.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const genesisWords = new Set(genesisPrompt.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  // Jaccard similarity
  const intersection = new Set([...soulWords].filter(w => genesisWords.has(w)));
  const union = new Set([...soulWords, ...genesisWords]);
  const jaccard = union.size > 0 ? intersection.size / union.size : 0;

  // Recall (how much of genesis is captured in soul)
  const recall = genesisWords.size > 0 ? intersection.size / genesisWords.size : 0;

  // Weighted combination
  return jaccard * 0.4 + recall * 0.6;
}

/**
 * Perform a soul reflection — compute alignment and auto-update sections.
 */
export function performReflection(
  db: AutomatonDatabase,
  config: { genesisPrompt: string; soulConfig: { autoUpdateCapabilities: boolean; autoUpdateRelationships: boolean; autoUpdateFinancialCharacter: boolean; alignmentThreshold: number } },
  survivalTier: SurvivalTier,
): { alignmentScore: number; autoUpdated: boolean; shouldWake: boolean } {
  const history = db.getSoulHistory();
  if (history.length === 0) {
    return { alignmentScore: 0, autoUpdated: false, shouldWake: false };
  }

  const latestSoul = history[0];
  const soul = parseSoul(latestSoul.content);
  let autoUpdated = false;

  // Auto-update capabilities from recent tool usage
  if (config.soulConfig.autoUpdateCapabilities) {
    const episodic = db.getEpisodicMemory(20);
    const toolCounts = new Map<string, number>();
    for (const ep of episodic) {
      try {
        const meta = JSON.parse(ep.metadata);
        for (const tool of (meta.toolCalls ?? [])) {
          toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
        }
      } catch { /* skip */ }
    }
    const newCaps = [...toolCounts.entries()]
      .filter(([_, count]) => count >= 3)
      .map(([name]) => name);
    if (newCaps.length > 0 && JSON.stringify(newCaps) !== JSON.stringify(soul.capabilities)) {
      soul.capabilities = newCaps;
      autoUpdated = true;
    }
  }

  // Auto-update relationships from inbox messages and tool usage
  if (config.soulConfig.autoUpdateRelationships) {
    const episodic = db.getEpisodicMemory(50);
    const agentInteractions = new Map<string, number>();
    for (const ep of episodic) {
      // Extract agent interactions from metadata
      try {
        const meta = JSON.parse(ep.metadata);
        if (meta.from) {
          agentInteractions.set(meta.from, (agentInteractions.get(meta.from) ?? 0) + 1);
        }
      } catch { /* skip */ }
    }
    const newRelationships = [...agentInteractions.entries()]
      .filter(([_, count]) => count >= 2)
      .map(([agentId, interactions]) => ({
        entity: agentId,
        type: 'peer',
        trustLevel: interactions >= 5 ? 'trusted' : 'acquaintance',
        notes: `Interacted ${interactions} times`,
      }));
    if (newRelationships.length > 0) {
      soul.relationships = newRelationships;
      autoUpdated = true;
    }
  }

  // Auto-update financial character
  if (config.soulConfig.autoUpdateFinancialCharacter) {
    if (survivalTier === 'critical') {
      soul.financialCharacter = 'Operating under severe financial stress. Prioritizing survival and cost reduction.';
      autoUpdated = true;
    } else if (survivalTier === 'low_compute') {
      soul.financialCharacter = 'Operating in low-compute mode. Being selective about resource usage.';
      autoUpdated = true;
    }
  }

  // Compute alignment
  const alignmentScore = computeAlignment(latestSoul.content, config.genesisPrompt);

  // Record updated soul if auto-updated
  if (autoUpdated) {
    const newContent = serializeSoul(soul);
    const hash = soulHash(newContent);
    db.insertSoulHistory({
      timestamp: Date.now(),
      content: newContent,
      contentHash: hash,
      alignmentScore,
      autoUpdated: true,
    });
  }

  const shouldWake = alignmentScore < config.soulConfig.alignmentThreshold;

  if (shouldWake) {
    logger.warn('Low soul alignment', { score: alignmentScore, threshold: config.soulConfig.alignmentThreshold });
  }

  return { alignmentScore, autoUpdated, shouldWake };
}
