/**
 * Conway Automaton — Agent Discovery
 * Discover agents via ERC-8004 registry contract with caching.
 */

import type { AutomatonDatabase, DiscoveredAgentCache } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('registry:discovery');

export class AgentDiscovery {
  private db: AutomatonDatabase;
  private cacheTtlMs = 30 * 60 * 1000; // 30 min

  constructor(db: AutomatonDatabase) {
    this.db = db;
  }

  async discover(address: string): Promise<DiscoveredAgentCache | null> {
    // Check cache
    const cached = this.db.getDiscoveredAgent(address);
    if (cached && Date.now() - cached.lastSeen < this.cacheTtlMs) {
      return cached;
    }

    // Would query ERC-8004 contract
    logger.debug('Agent not in cache', { address });
    return null;
  }

  cache(agent: DiscoveredAgentCache): void {
    this.db.setDiscoveredAgent(agent);
  }
}
