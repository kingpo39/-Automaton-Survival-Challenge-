/**
 * Conway Automaton — Social Protocol
 * Message format definitions for agent-to-agent communication.
 */

import type { SocialMessage } from '../types.js';

export function createMessage(
  from: string,
  to: string,
  content: string,
  type: SocialMessage['type'] = 'message',
  signFn: (message: string) => string = (m) => `signed:${m.length}`,
): SocialMessage {
  const messageData = `${from}:${to}:${content}:${Date.now()}`;
  return {
    id: crypto.randomUUID(),
    from,
    to,
    content,
    signature: signFn(messageData),
    timestamp: Date.now(),
    type,
  };
}
