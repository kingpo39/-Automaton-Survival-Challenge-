/**
 * survival/sensors/index.ts
 * 
 * THE EYES AND EARS.
 * 
 * Reads all system signals in parallel. No LLM, no I/O blocking.
 * Returns a deterministic snapshot of system health.
 * 
 * Core principle: READ EVERYTHING, BLOCK ON NOTHING.
 */

import { createLogger } from '../../observability/logger.js'
import type { AutomatonDatabase } from '../../types.js'

const log = createLogger('survival:sensors')

// ── Types ────────────────────────────────────────────────────────────────────

export type RamPressure = 'normal' | 'moderate' | 'severe' | 'critical'

export interface SensorReadings {
  // Financial
  usdcBalance: number            // USDC in dollars (e.g., 25.50)
  
  // Compute
  ramFreeBytes: number           // Free RAM in bytes
  ramTotalBytes: number          // Total RAM in bytes
  ramPressure: RamPressure       // Derived from free RAM
  cpuLoadPercent: number         // CPU load 0-100
  
  // Model (Ollama)
  ollamaHealthy: boolean         // Is Ollama responding?
  ollamaResponseMs: number       // Response time (healthy = < 2000ms)
  consecutiveInferenceFailures: number  // How many failures in a row?
  
  // Infrastructure
  dbHealthy: boolean             // Can we write to DB?
  networkHealthy: boolean        // Can we reach the internet?
  
  // Metadata
  timestamp: number              // When readings were taken
  sensorsMs: number              // How long the read took
}

// ── Sensor Layer ─────────────────────────────────────────────────────────────

export class SensorLayer {
  private lastOllamaHealthy = true
  private lastConsecutiveFailures = 0

  constructor(
    private readonly db: AutomatonDatabase,
    private readonly conwayApiUrl: string,
    private readonly ollamaUrl: string = 'http://localhost:11434',
  ) {}

  /**
   * Read all sensors in parallel.
   * Returns a complete snapshot in < 100ms.
   */
  async read(): Promise<SensorReadings> {
    const start = Date.now()
    
    const [usdcBalance, compute, model, infra] = await Promise.all([
      this.readFinancial(),
      this.readCompute(),
      this.readModel(),
      this.readInfra(),
    ])

    return {
      usdcBalance,
      ...compute,
      ...model,
      ...infra,
      timestamp: Date.now(),
      sensorsMs: Date.now() - start,
    }
  }

  // ── Financial Sensors ────────────────────────────────────────────────────

  private async readFinancial(): Promise<number> {
    try {
      // Read from DB cache (updated by heartbeat)
      const cached = this.db.getKV('last_usdc_balance')
      if (cached) {
        return parseFloat(cached)
      }
      // Fallback: assume zero if never read
      return 0
    } catch (err) {
      log.warn('Failed to read USDC balance', { error: String(err) })
      return 0
    }
  }

  // ── Compute Sensors ──────────────────────────────────────────────────────

  private async readCompute(): Promise<{
    ramFreeBytes: number
    ramTotalBytes: number
    ramPressure: RamPressure
    cpuLoadPercent: number
  }> {
    try {
      const { freemem, totalmem, loadavg } = await import('os')
      
      const totalBytes = totalmem()
      const freeBytes = freemem()
      const usedBytes = totalBytes - freeBytes
      const usedPercent = (usedBytes / totalBytes) * 100
      
      // RAM pressure thresholds (tuned for 7.84 GB total)
      let pressure: RamPressure = 'normal'
      if (freeBytes < 512 * 1024 * 1024) {        // < 512 MB
        pressure = 'critical'
      } else if (freeBytes < 1024 * 1024 * 1024) { // < 1 GB
        pressure = 'severe'
      } else if (freeBytes < 1536 * 1024 * 1024) { // < 1.5 GB
        pressure = 'moderate'
      }

      // CPU load (1-minute average)
      const load1m = loadavg()[0]
      const cpuCount = (await import('os')).cpus().length
      const cpuPercent = Math.min(100, Math.round((load1m / cpuCount) * 100))

      return {
        ramFreeBytes: freeBytes,
        ramTotalBytes: totalBytes,
        ramPressure: pressure,
        cpuLoadPercent: cpuPercent,
      }
    } catch (err) {
      log.warn('Failed to read compute metrics', { error: String(err) })
      return {
        ramFreeBytes: 0,
        ramTotalBytes: 0,
        ramPressure: 'critical',
        cpuLoadPercent: 100,
      }
    }
  }

  // ── Model Sensors (Ollama) ───────────────────────────────────────────────

  private async readModel(): Promise<{
    ollamaHealthy: boolean
    ollamaResponseMs: number
    consecutiveInferenceFailures: number
  }> {
    const start = Date.now()
    let healthy = false
    let responseMs = 0

    try {
      // Simple health check: GET /api/tags
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000) // 2s timeout

      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: controller.signal,
        method: 'GET',
      })
      
      clearTimeout(timeout)
      healthy = response.ok
      responseMs = Date.now() - start
    } catch {
      healthy = false
      responseMs = Date.now() - start
    }

    // Track consecutive failures
    if (healthy) {
      this.lastOllamaHealthy = true
      this.lastConsecutiveFailures = 0
    } else {
      if (this.lastOllamaHealthy) {
        // First failure
        this.lastConsecutiveFailures = 1
      } else {
        this.lastConsecutiveFailures++
      }
      this.lastOllamaHealthy = false
    }

    return {
      ollamaHealthy: healthy,
      ollamaResponseMs: responseMs,
      consecutiveInferenceFailures: this.lastConsecutiveFailures,
    }
  }

  // ── Infrastructure Sensors ───────────────────────────────────────────────

  private async readInfra(): Promise<{
    dbHealthy: boolean
    networkHealthy: boolean
  }> {
    const [dbHealthy, networkHealthy] = await Promise.all([
      this.checkDbHealth(),
      this.checkNetworkHealth(),
    ])

    return { dbHealthy, networkHealthy }
  }

  private async checkDbHealth(): Promise<boolean> {
    try {
      // Try a simple read/write operation
      const key = `health_check_${Date.now()}`
      this.db.setKV(key, 'ping')
      const value = this.db.getKV(key)
      this.db.deleteKV(key)
      return value === 'ping'
    } catch {
      return false
    }
  }

  private async checkNetworkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000) // 2s timeout

      // Try to reach a reliable endpoint
      const response = await fetch('https://1.1.1.1', {
        method: 'HEAD',
        signal: controller.signal,
      })
      
      clearTimeout(timeout)
      return response.ok || response.status === 403 // Cloudflare returns 403 for HEAD
    } catch {
      return false
    }
  }
}
