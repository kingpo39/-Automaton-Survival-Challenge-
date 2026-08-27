/**
 * survival/packet-capture.ts
 * 
 * WIRESHARK-LIKE PACKET CAPTURE FOR AGENT SURVIVAL
 * 
 * Captures EVERY packet in the system — no filtering, no judgment.
 * Every API call, every message, every heartbeat, every inference.
 * All captured, all timestamped, all searchable.
 * 
 * Core principle: PCAP FOR AGENTS
 * Like Wireshark captures every network packet, this captures every agent signal.
 * Analysis happens AFTER capture — never drop a packet.
 */

import { createLogger } from '../observability/logger.js'
import type { AutomatonDatabase, SurvivalTier, TurnRecord } from '../types.js'

const log = createLogger('survival:packet-capture')

// ── Packet Types ─────────────────────────────────────────────────────────────

export type PacketType = 
  | 'financial'      // USDC, credits, transfers
  | 'compute'        // RAM, CPU, disk
  | 'model'          // Inference requests/responses
  | 'infra'          // DB, network, heartbeat
  | 'social'         // Messages, inbox, children
  | 'discussion'     // Multi-agent discussions
  | 'moderator'      // Moderator summaries
  | 'policy'         // Policy decisions
  | 'survival'       // Tier changes, distress
  | 'tool'           // Tool executions
  | 'memory'         // Memory operations
  | 'soul'           // Soul reflection
  | 'heartbeat'      // Heartbeat ticks

export interface Packet {
  id: string
  type: PacketType
  timestamp: number
  source: string
  destination?: string
  payload: PacketPayload
  metadata: PacketMetadata
}

export interface PacketPayload {
  data: Record<string, unknown>
  raw?: string
}

export interface PacketMetadata {
  size: number
  priority: number
  tags: string[]
  relatedPackets?: string[]
}

// ── Specific Packet Payloads ─────────────────────────────────────────────────

export interface FinancialPacketData {
  action: 'balance_check' | 'transfer' | 'topup' | 'spend'
  amount?: number
  currency: string
  balance?: number
  recipient?: string
}

export interface ModelPacketData {
  action: 'request' | 'response' | 'failure' | 'fallback'
  model: string
  provider: string
  tokens?: { prompt: number; completion: number }
  latencyMs?: number
  error?: string
}

export interface DiscussionPacketData {
  action: 'message' | 'moderation' | 'consensus' | 'summary'
  discussionId: string
  participantId?: string
  content?: string
  sentiment?: string
  topics?: string[]
}

export interface SurvivalPacketData {
  action: 'tier_change' | 'distress' | 'funding' | 'recovery'
  fromTier?: SurvivalTier
  toTier?: SurvivalTier
  reason?: string
  threatScore?: number
}

// ── Packet Capture ───────────────────────────────────────────────────────────

let idCounter = 0

function generateId(): string {
  return `pkt_${Date.now()}_${(idCounter++).toString(36)}`
}

export class PacketCapture {
  private buffer: Packet[] = []
  private bufferSize = 10000
  private packetCounter = 0

  constructor(
    private readonly db: AutomatonDatabase,
    private readonly options?: {
      bufferSize?: number
      logLevel?: 'minimal' | 'standard' | 'verbose'
    }
  ) {
    this.bufferSize = options?.bufferSize ?? 10000
  }

  /**
   * Capture a packet. Never throws, never blocks.
   */
  capture(
    type: PacketType,
    source: string,
    payload: Record<string, unknown>,
    metadata?: Partial<PacketMetadata>
  ): Packet {
    const packet: Packet = {
      id: generateId(),
      type,
      timestamp: Date.now(),
      source,
      payload: { data: payload },
      metadata: {
        size: JSON.stringify(payload).length,
        priority: this.computePriority(type, payload),
        tags: this.extractTags(type, payload),
        ...metadata,
      },
    }

    this.buffer.push(packet)
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift()
    }
    this.packetCounter++

    if (packet.metadata.priority >= 50) {
      this.persistPacket(packet)
    }

    if (this.options?.logLevel === 'verbose') {
      log.debug('Packet captured', { type, source, id: packet.id })
    }

    return packet
  }

  captureFinancial(source: string, data: FinancialPacketData): Packet {
    return this.capture('financial', source, data as unknown as Record<string, unknown>)
  }

  captureModel(source: string, data: ModelPacketData): Packet {
    return this.capture('model', source, data as unknown as Record<string, unknown>)
  }

  captureDiscussion(source: string, data: DiscussionPacketData): Packet {
    return this.capture('discussion', source, data as unknown as Record<string, unknown>)
  }

  captureSurvival(source: string, data: SurvivalPacketData): Packet {
    return this.capture('survival', source, data as unknown as Record<string, unknown>, {
      priority: 80,
    })
  }

  getBuffer(): Packet[] {
    return [...this.buffer]
  }

  getPacketsByType(type: PacketType, limit?: number): Packet[] {
    const filtered = this.buffer.filter(p => p.type === type)
    return limit ? filtered.slice(0, limit) : filtered
  }

  getRecentPackets(seconds: number): Packet[] {
    const cutoff = Date.now() - (seconds * 1000)
    return this.buffer.filter(p => p.timestamp > cutoff)
  }

  query(predicate: (packet: Packet) => boolean, limit?: number): Packet[] {
    const matched = this.buffer.filter(predicate)
    return limit ? matched.slice(0, limit) : matched
  }

  getStats(): PacketStats {
    const byType = new Map<string, number>()
    const bySource = new Map<string, number>()
    let totalSize = 0

    for (const packet of this.buffer) {
      byType.set(packet.type, (byType.get(packet.type) ?? 0) + 1)
      bySource.set(packet.source, (bySource.get(packet.source) ?? 0) + 1)
      totalSize += packet.metadata.size
    }

    return {
      totalPackets: this.buffer.length,
      totalCaptured: this.packetCounter,
      totalSize,
      byType: Object.fromEntries(byType),
      bySource: Object.fromEntries(bySource),
      oldestPacket: this.buffer[0]?.timestamp,
      newestPacket: this.buffer[this.buffer.length - 1]?.timestamp,
    }
  }

  exportPcap(startMs?: number, endMs?: number): string {
    let packets = this.buffer
    if (startMs) packets = packets.filter(p => p.timestamp >= startMs)
    if (endMs) packets = packets.filter(p => p.timestamp <= endMs)
    
    return JSON.stringify({
      version: '1.0',
      captureDate: new Date().toISOString(),
      packetCount: packets.length,
      packets,
    }, null, 2)
  }

  clear(): void {
    this.buffer = []
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private computePriority(type: PacketType, payload: Record<string, unknown>): number {
    const basePriority: Record<PacketType, number> = {
      survival: 90,
      financial: 80,
      model: 70,
      infra: 60,
      social: 50,
      discussion: 40,
      moderator: 40,
      policy: 30,
      tool: 20,
      memory: 10,
      soul: 10,
      heartbeat: 5,
      compute: 5,
    }
    return basePriority[type] ?? 10
  }

  private extractTags(type: PacketType, payload: Record<string, unknown>): string[] {
    const tags: string[] = [type]
    
    if (payload['action']) tags.push(String(payload['action']))
    if (payload['model']) tags.push(String(payload['model']))
    if (payload['error']) tags.push('error')
    
    return tags
  }

  private persistPacket(packet: Packet): void {
    try {
      const key = `packet:${packet.type}:${packet.id}`
      this.db.setKV(key, JSON.stringify(packet))
      // Auto-cleanup: set TTL-like behavior via timestamp
      this.db.setKV(`${key}:ts`, packet.timestamp.toString())
    } catch {
      // Non-critical — packet is still in buffer
    }
  }
}

export interface PacketStats {
  totalPackets: number
  totalCaptured: number
  totalSize: number
  byType: Record<string, number>
  bySource: Record<string, number>
  oldestPacket?: number
  newestPacket?: number
}
