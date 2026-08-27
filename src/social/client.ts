/**
 * Conway Automaton — Social Client
 * HTTP client for the Conway social relay (social.conway.tech).
 */

import { ResilientHttpClient } from '../conway/http-client.js';
import type { SocialMessage } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('social:client');

export class SocialClient {
  private http: ResilientHttpClient;

  constructor(relayUrl: string) {
    this.http = new ResilientHttpClient(relayUrl);
  }

  async send(message: SocialMessage): Promise<void> {
    await this.http.post('/messages', message);
    logger.info('Message sent', { to: message.to, type: message.type });
  }

  async poll(address: string, since?: number): Promise<SocialMessage[]> {
    const params = new URLSearchParams({ address });
    if (since) params.set('since', String(since));
    const result = await this.http.get(`/messages?${params}`);
    return (result.body as { messages: SocialMessage[] }).messages ?? [];
  }

  async getAgentCard(address: string): Promise<Record<string, unknown> | null> {
    try {
      const result = await this.http.get(`/agents/${address}`);
      return result.body as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
