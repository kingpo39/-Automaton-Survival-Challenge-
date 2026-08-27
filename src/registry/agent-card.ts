/**
 * Conway Automaton — Agent Card
 * ERC-8004 agent card builder (JSON-LD).
 */

import type { AgentCard } from '../types.js';

export function buildAgentCard(options: {
  address: string;
  name: string;
  description: string;
  capabilities: string[];
  contactUrl?: string;
}): AgentCard {
  return {
    '@context': ['https://schema.org', 'https://erc8004.org/context'],
    '@type': 'AI Agent',
    address: options.address,
    name: options.name,
    description: options.description,
    capabilities: options.capabilities,
    services: [],
    contact: {
      type: 'ethereum',
      value: options.address,
    },
  };
}
