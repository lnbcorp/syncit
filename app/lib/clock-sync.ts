/**
 * Clock Synchronization Utilities
 * Implements NTP-style clock sync using DataChannel pings
 */

import {
  createTimeSyncRequest,
  createTimeSyncResponse,
  calculateClockOffset,
  type TimeSyncRequest,
  type TimeSyncResponse,
} from './datachannel-messages';

export interface ClockSyncProbe {
  requestTime: number; // Client time when request was sent
  serverTime: number; // Server time when request was received
  responseTime: number; // Server time when response was sent
  receiveTime: number; // Client time when response was received
  messageId: string;
}

export interface ClockSyncResult {
  offset: number; // Clock offset in milliseconds (positive = server is ahead)
  oneWayLatency: number; // Estimated one-way latency in milliseconds
  roundTripTime: number; // Round-trip time in milliseconds
  drift: number; // Clock drift rate (ms per second)
  probes: ClockSyncProbe[];
}

/**
 * Calculate clock offset from a single probe
 */
function calculateProbeOffset(probe: ClockSyncProbe): number {
  const roundTripTime = probe.receiveTime - probe.requestTime;
  const serverProcessingTime = probe.responseTime - probe.serverTime;
  const networkTime = roundTripTime - serverProcessingTime;
  const oneWayTime = networkTime / 2;
  
  // Calculate offset: server time at request - (client time at request + one-way time)
  const serverTimeAtRequest = probe.serverTime + oneWayTime;
  const offset = serverTimeAtRequest - probe.requestTime;
  
  return offset;
}

/**
 * Calculate one-way latency from a probe
 */
function calculateProbeLatency(probe: ClockSyncProbe): number {
  const roundTripTime = probe.receiveTime - probe.requestTime;
  const serverProcessingTime = probe.responseTime - probe.serverTime;
  const networkTime = roundTripTime - serverProcessingTime;
  return networkTime / 2;
}

/**
 * Calculate clock drift from multiple probes
 */
function calculateDrift(probes: ClockSyncProbe[]): number {
  if (probes.length < 2) return 0;

  // Sort probes by request time
  const sorted = [...probes].sort((a, b) => a.requestTime - b.requestTime);
  
  // Calculate offset change over time
  const firstOffset = calculateProbeOffset(sorted[0]);
  const lastOffset = calculateProbeOffset(sorted[sorted.length - 1]);
  const timeDelta = (sorted[sorted.length - 1].requestTime - sorted[0].requestTime) / 1000; // Convert to seconds
  
  if (timeDelta === 0) return 0;
  
  const drift = (lastOffset - firstOffset) / timeDelta; // ms per second
  return drift;
}

/**
 * Calculate median of an array of numbers
 */
function median(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    return sorted[mid];
  }
}

/**
 * Process clock sync probes and calculate offset, latency, and drift
 */
export function processClockSyncProbes(probes: ClockSyncProbe[]): ClockSyncResult {
  if (probes.length === 0) {
    throw new Error('No probes provided');
  }

  // Calculate offset for each probe
  const offsets = probes.map(probe => calculateProbeOffset(probe));
  
  // Use median offset (more robust to outliers than mean)
  const medianOffset = median(offsets);
  
  // Calculate one-way latency for each probe
  const latencies = probes.map(probe => calculateProbeLatency(probe));
  
  // Use median latency
  const medianLatency = median(latencies);
  
  // Calculate round-trip time
  const roundTripTimes = probes.map(probe => probe.receiveTime - probe.requestTime);
  const medianRoundTripTime = median(roundTripTimes);
  
  // Calculate drift
  const drift = calculateDrift(probes);
  
  return {
    offset: medianOffset,
    oneWayLatency: medianLatency,
    roundTripTime: medianRoundTripTime,
    drift,
    probes,
  };
}

/**
 * Clock Synchronization Manager
 * Handles 5 quick ping probes on connection
 * Works with both WebSocket and DataChannel messages
 */
export class ClockSyncManager {
  private probes: ClockSyncProbe[] = [];
  private pendingProbes: Map<string, { requestTime: number; messageId: string }> = new Map();
  private onComplete?: (result: ClockSyncResult) => void;
  private sendMessage: (message: any) => void;
  private maxProbes: number = 5;
  private probeInterval: number = 50; // 50ms between probes
  private timeout: number = 5000; // 5 second timeout
  private startTime: number = 0;
  private timeoutHandle: NodeJS.Timeout | null = null;

  constructor(sendMessage: (message: any) => void) {
    this.sendMessage = sendMessage;
  }

  /**
   * Start clock synchronization with 5 quick ping probes
   */
  start(onComplete: (result: ClockSyncResult) => void): void {
    this.probes = [];
    this.pendingProbes.clear();
    this.onComplete = onComplete;
    this.startTime = Date.now();

    // Send 5 quick probes
    for (let i = 0; i < this.maxProbes; i++) {
      setTimeout(() => {
        this.sendProbe();
      }, i * this.probeInterval);
    }

    // Set timeout
    this.timeoutHandle = setTimeout(() => {
      if (this.pendingProbes.size > 0) {
        console.warn('Clock sync timeout - some probes did not complete');
        this.complete();
      }
    }, this.timeout);
  }

  /**
   * Send a single probe
   */
  private sendProbe(): void {
    const request = createTimeSyncRequest();
    const requestTime = performance.now(); // Use high-resolution time
    
    this.pendingProbes.set(request.messageId || '', {
      requestTime: Date.now(), // Use Date.now() for absolute time
      messageId: request.messageId || '',
    });
    
    this.sendMessage(request);
  }

  /**
   * Handle time sync response
   */
  handleResponse(response: TimeSyncResponse): void {
    const pending = this.pendingProbes.get(response.messageId || '');
    if (!pending) {
      return; // Not our probe
    }

    const receiveTime = Date.now();
    const probe: ClockSyncProbe = {
      requestTime: pending.requestTime,
      serverTime: response.serverTime,
      responseTime: response.responseTime,
      receiveTime,
      messageId: response.messageId || '',
    };

    this.probes.push(probe);
    this.pendingProbes.delete(response.messageId || '');

    // If we have all probes, complete
    if (this.probes.length >= this.maxProbes) {
      this.complete();
    }
  }

  /**
   * Complete clock synchronization
   */
  private complete(): void {
    if (this.probes.length === 0) {
      console.warn('Clock sync completed with no probes');
      return;
    }

    try {
      const result = processClockSyncProbes(this.probes);
      this.onComplete?.(result);
    } catch (error) {
      console.error('Error processing clock sync probes:', error);
    }

    // Cleanup
    this.probes = [];
    this.pendingProbes.clear();
  }

  /**
   * Get current probes (for debugging)
   */
  getProbes(): ClockSyncProbe[] {
    return [...this.probes];
  }

  /**
   * Reset clock sync manager
   */
  reset(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.probes = [];
    this.pendingProbes.clear();
    this.onComplete = undefined;
  }
}

