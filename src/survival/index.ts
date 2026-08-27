export { requestFunding } from './funding.js';
export { checkTierTransition, getResourceStatus } from './monitor.js';
export { enterLowCompute, LOW_COMPUTE_DEFAULTS, type LowComputeConfig } from './low-compute.js';

// Advanced survival system
export { SurvivalBrain } from './brain.js';
export { SensorLayer, type SensorReadings, type RamPressure } from './sensors/index.js';
export { TierEvaluator, type TierEvaluation, TIER_LEVEL, worstTier } from './tiers/evaluator.js';
export { BehaviorEnforcer, TIER_BLOCK_LISTS, TIER_ALLOW_LISTS, TIER_MODELS, TICK_MS } from './tiers/behaviors.js';
export { ActuatorLayer, type TransitionResult } from './actuators/index.js';
export { ModeratorSniffer } from './moderator.js';
export type { SnifferSnapshot, FinancialSignals, ComputeSignals, ModelSignals, InfraSignals, SocialSignals, DiscussionSignal, AlertSignal } from './moderator.js';

// Wireshark-like packet capture
export { PacketCapture } from './packet-capture.js';
export type { Packet, PacketType, PacketMetadata, FinancialPacketData, ModelPacketData, DiscussionPacketData, SurvivalPacketData, PacketStats } from './packet-capture.js';

// Enriched moderator (reads multi-agent discussions)
export { EnrichedModerator } from './moderator-enriched.js';
export type { ModeratorSummary, SurvivalSignal, EnrichedSnapshot } from './moderator-enriched.js';

// Re-export SurvivalTier for convenience
export type { SurvivalTier } from '../types.js';
