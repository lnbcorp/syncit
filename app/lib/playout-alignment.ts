/**
 * Playout Alignment Utilities
 * Implements playout time alignment across listeners using server timestamps
 */

import type { ClockSyncResult } from './clock-sync';

export interface PlayoutAlignmentConfig {
  targetLatency: number; // Target playout latency in ms (e.g., 50ms)
  maxLatency: number; // Maximum acceptable latency in ms (e.g., 100ms)
  minLatency: number; // Minimum acceptable latency in ms (e.g., 20ms)
  driftCorrectionInterval: number; // How often to correct for drift (ms)
  jitterBufferBias: number; // Bias factor for jitter buffer (0.0 to 1.0)
}

const DEFAULT_CONFIG: PlayoutAlignmentConfig = {
  targetLatency: 50, // 50ms target latency
  maxLatency: 100, // 100ms max latency
  minLatency: 20, // 20ms min latency
  driftCorrectionInterval: 1000, // Correct drift every second
  jitterBufferBias: 0.7, // Bias towards target time (70%)
};

export interface PlayoutState {
  serverTimestamp: number; // Server timestamp when audio was produced
  clientReceiveTime: number; // Client time when audio was received
  targetPlayoutTime: number; // Calculated target playout time
  currentPlayoutTime: number; // Current playout time
  clockOffset: number; // Clock offset from server (ms)
  drift: number; // Clock drift rate (ms per second)
  lastCorrection: number; // Last drift correction time
}

/**
 * Calculate target playout time from server timestamp
 */
export function calculateTargetPlayoutTime(
  serverTimestamp: number,
  clockOffset: number,
  config: PlayoutAlignmentConfig = DEFAULT_CONFIG
): number {
  // Convert server timestamp to client time
  const clientTime = serverTimestamp - clockOffset;
  
  // Add target latency to get playout time
  const targetPlayoutTime = clientTime + config.targetLatency;
  
  return targetPlayoutTime;
}

/**
 * Calculate playout delay adjustment based on current state
 */
export function calculatePlayoutAdjustment(
  state: PlayoutState,
  config: PlayoutAlignmentConfig = DEFAULT_CONFIG
): number {
  const now = Date.now();
  const timeUntilTarget = state.targetPlayoutTime - now;
  
  // If we're too far ahead, slow down
  if (timeUntilTarget < -config.maxLatency) {
    return -config.maxLatency; // Maximum slowdown
  }
  
  // If we're too far behind, speed up (but limit)
  if (timeUntilTarget > config.maxLatency) {
    return config.maxLatency; // Maximum speedup
  }
  
  // Normal adjustment towards target
  return timeUntilTarget * config.jitterBufferBias;
}

/**
 * Apply drift correction to playout state
 */
export function applyDriftCorrection(
  state: PlayoutState,
  config: PlayoutAlignmentConfig = DEFAULT_CONFIG
): PlayoutState {
  const now = Date.now();
  const timeSinceLastCorrection = now - state.lastCorrection;
  
  // Apply drift correction if enough time has passed
  if (timeSinceLastCorrection >= config.driftCorrectionInterval) {
    // Update clock offset based on drift
    const driftCorrection = (state.drift * timeSinceLastCorrection) / 1000;
    const updatedState: PlayoutState = {
      ...state,
      clockOffset: state.clockOffset + driftCorrection,
      lastCorrection: now,
    };
    
    // Recalculate target playout time with updated offset
    updatedState.targetPlayoutTime = calculateTargetPlayoutTime(
      state.serverTimestamp,
      updatedState.clockOffset,
      config
    );
    
    return updatedState;
  }
  
  return state;
}

/**
 * Playout Alignment Manager
 * Manages playout timing alignment across listeners
 */
export class PlayoutAlignmentManager {
  private state: PlayoutState | null = null;
  private config: PlayoutAlignmentConfig;
  private clockSyncResult: ClockSyncResult | null = null;
  private correctionInterval: NodeJS.Timeout | null = null;
  private audioContext: AudioContext | null = null;
  private playbackRate: number = 1.0;

  constructor(config: Partial<PlayoutAlignmentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize with clock sync result
   */
  initialize(clockSyncResult: ClockSyncResult): void {
    this.clockSyncResult = clockSyncResult;
    
    // Start continuous drift correction
    this.startDriftCorrection();
  }

  /**
   * Update playout state with server timestamp
   */
  updatePlayoutState(serverTimestamp: number, clientReceiveTime: number): void {
    if (!this.clockSyncResult) {
      console.warn('Playout alignment not initialized with clock sync');
      return;
    }

    const clockOffset = this.clockSyncResult.offset;
    const drift = this.clockSyncResult.drift;

    const targetPlayoutTime = calculateTargetPlayoutTime(
      serverTimestamp,
      clockOffset,
      this.config
    );

    this.state = {
      serverTimestamp,
      clientReceiveTime,
      targetPlayoutTime,
      currentPlayoutTime: clientReceiveTime, // Initial playout time
      clockOffset,
      drift,
      lastCorrection: Date.now(),
    };
  }

  /**
   * Get current playout adjustment
   */
  getPlayoutAdjustment(): number {
    if (!this.state) {
      return 0;
    }

    // Apply drift correction
    this.state = applyDriftCorrection(this.state, this.config);

    // Calculate adjustment
    return calculatePlayoutAdjustment(this.state, this.config);
  }

  /**
   * Apply playout adjustment to audio element
   */
  applyPlayoutAdjustment(audioElement: HTMLAudioElement, adjustment: number): void {
    // Clamp adjustment to reasonable range
    const clampedAdjustment = Math.max(-this.config.maxLatency, Math.min(this.config.maxLatency, adjustment));
    
    // Convert adjustment to playback rate
    // Positive adjustment (behind) = speed up (rate > 1.0)
    // Negative adjustment (ahead) = slow down (rate < 1.0)
    // Adjustment is in ms, convert to rate change
    const rateChange = clampedAdjustment / 1000; // Convert ms to seconds
    const newRate = 1.0 + (rateChange * 0.1); // Scale down for smooth adjustment
    
    // Clamp playback rate to reasonable range (0.95 to 1.05)
    const clampedRate = Math.max(0.95, Math.min(1.05, newRate));
    
    if (audioElement.playbackRate !== clampedRate) {
      audioElement.playbackRate = clampedRate;
      this.playbackRate = clampedRate;
    }
  }

  /**
   * Use Web Audio API for fine timing control
   */
  async initializeWebAudio(audioElement: HTMLAudioElement): Promise<AudioContext | null> {
    try {
      // Create AudioContext if not exists
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      // Create media element source
      const source = this.audioContext.createMediaElementSource(audioElement);
      
      // Create gain node for volume control
      const gainNode = this.audioContext.createGain();
      
      // Create delay node for fine timing adjustment
      const delayNode = this.audioContext.createDelay(0.1); // Max 100ms delay
      
      // Connect: source -> delay -> gain -> destination
      source.connect(delayNode);
      delayNode.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      return this.audioContext;
    } catch (error) {
      console.error('Failed to initialize Web Audio:', error);
      return null;
    }
  }

  /**
   * Apply fine timing adjustment using Web Audio delay node
   */
  applyFineTimingAdjustment(delayNode: DelayNode, adjustment: number): void {
    if (!delayNode) return;

    // Convert adjustment (ms) to delay (seconds)
    // Clamp to reasonable range (0 to 100ms)
    const clampedAdjustment = Math.max(0, Math.min(100, adjustment));
    const delaySeconds = clampedAdjustment / 1000;

    try {
      delayNode.delayTime.value = delaySeconds;
    } catch (error) {
      console.error('Failed to set delay time:', error);
    }
  }

  /**
   * Start continuous drift correction
   */
  private startDriftCorrection(): void {
    if (this.correctionInterval) {
      clearInterval(this.correctionInterval);
    }

    this.correctionInterval = setInterval(() => {
      if (this.state) {
        this.state = applyDriftCorrection(this.state, this.config);
      }
    }, this.config.driftCorrectionInterval);
  }

  /**
   * Stop drift correction
   */
  stopDriftCorrection(): void {
    if (this.correctionInterval) {
      clearInterval(this.correctionInterval);
      this.correctionInterval = null;
    }
  }

  /**
   * Get current playout state
   */
  getState(): PlayoutState | null {
    return this.state;
  }

  /**
   * Get current playback rate
   */
  getPlaybackRate(): number {
    return this.playbackRate;
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.stopDriftCorrection();
    if (this.audioContext) {
      this.audioContext.close().catch(console.error);
      this.audioContext = null;
    }
    this.state = null;
    this.clockSyncResult = null;
  }
}

