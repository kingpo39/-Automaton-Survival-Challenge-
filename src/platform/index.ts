/**
 * platform/index.ts
 *
 * Platform services barrel export.
 * WebSocket management, connection health monitoring, and relay communication.
 */

export { WSManager } from './ws-manager.js'
export type { WSState, WSConfig, WSStats } from './ws-manager.js'

export { ConnectionHealthMonitor } from './connection-health.js'
export type { ConnectionStatus } from './connection-health.js'
