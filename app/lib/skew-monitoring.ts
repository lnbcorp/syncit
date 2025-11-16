/**
 * Skew Monitoring Utilities
 * Implements skew monitoring and sync status calculation
 */

export interface ToneMark {
  listenerPeerId: string;
  timestamp: number; // Client timestamp when tone was detected
  serverTimestamp?: number; // Server timestamp (if available)
  sequence: number; // Sequence number for ordering
}

export interface SkewEstimate {
  listenerPeerId: string;
  skew: number; // Skew in milliseconds (relative to reference)
  latency: number; // Estimated latency
  confidence: number; // Confidence level (0.0 to 1.0)
}

export interface SyncStatus {
  status: 'good' | 'fair' | 'poor';
  skew: number; // Maximum skew in milliseconds
  listenerCount: number; // Number of listeners being monitored
  threshold: number; // Threshold used (LAN or WAN)
}

// Thresholds for sync status
const LAN_THRESHOLD_GOOD = 15; // ≤15ms for "Good" on LAN
const LAN_THRESHOLD_FAIR = 30; // ≤30ms for "Fair" on LAN
const WAN_THRESHOLD_GOOD = 35; // ≤35ms for "Good" on WAN
const WAN_THRESHOLD_FAIR = 70; // ≤70ms for "Fair" on WAN

/**
 * Determine if connection is LAN or WAN based on latency
 */
export function isLANConnection(avgLatency: number): boolean {
  // If average latency is less than 50ms, assume LAN
  return avgLatency < 50;
}

/**
 * Get sync status thresholds based on connection type
 */
export function getSyncThresholds(isLAN: boolean): { good: number; fair: number } {
  if (isLAN) {
    return { good: LAN_THRESHOLD_GOOD, fair: LAN_THRESHOLD_FAIR };
  } else {
    return { good: WAN_THRESHOLD_GOOD, fair: WAN_THRESHOLD_FAIR };
  }
}

/**
 * Calculate sync status from skew estimates
 */
export function calculateSyncStatus(
  skewEstimates: SkewEstimate[],
  avgLatency: number
): SyncStatus {
  if (skewEstimates.length === 0) {
    return {
      status: 'poor',
      skew: Infinity,
      listenerCount: 0,
      threshold: WAN_THRESHOLD_GOOD,
    };
  }

  // Find maximum skew
  const maxSkew = Math.max(...skewEstimates.map(e => Math.abs(e.skew)));

  // Determine if LAN or WAN
  const isLAN = isLANConnection(avgLatency);
  const thresholds = getSyncThresholds(isLAN);

  // Determine status
  let status: 'good' | 'fair' | 'poor';
  if (maxSkew <= thresholds.good) {
    status = 'good';
  } else if (maxSkew <= thresholds.fair) {
    status = 'fair';
  } else {
    status = 'poor';
  }

  return {
    status,
    skew: maxSkew,
    listenerCount: skewEstimates.length,
    threshold: thresholds.good,
  };
}

/**
 * Estimate relative skew between listeners using tone marks
 * Uses the median listener as reference
 */
export function estimateSkew(toneMarks: ToneMark[]): SkewEstimate[] {
  if (toneMarks.length === 0) {
    return [];
  }

  // Group tone marks by listener
  const marksByListener = new Map<string, ToneMark[]>();
  for (const mark of toneMarks) {
    if (!marksByListener.has(mark.listenerPeerId)) {
      marksByListener.set(mark.listenerPeerId, []);
    }
    marksByListener.get(mark.listenerPeerId)!.push(mark);
  }

  // Calculate median timestamp for each listener
  const listenerMedians = new Map<string, number>();
  for (const [peerId, marks] of marksByListener.entries()) {
    const timestamps = marks.map(m => m.timestamp).sort((a, b) => a - b);
    const median = timestamps[Math.floor(timestamps.length / 2)];
    listenerMedians.set(peerId, median);
  }

  // Use overall median as reference
  const allMedians = Array.from(listenerMedians.values()).sort((a, b) => a - b);
  const referenceMedian = allMedians[Math.floor(allMedians.length / 2)];

  // Calculate skew for each listener
  const estimates: SkewEstimate[] = [];
  for (const [peerId, median] of listenerMedians.entries()) {
    const skew = median - referenceMedian;
    const marks = marksByListener.get(peerId)!;
    
    // Calculate confidence based on number of samples
    const confidence = Math.min(1.0, marks.length / 10); // Full confidence at 10+ samples
    
    // Estimate latency (simplified - would need RTT data for accurate estimate)
    const latency = Math.abs(skew) * 0.5; // Rough estimate

    estimates.push({
      listenerPeerId: peerId,
      skew,
      latency,
      confidence,
    });
  }

  return estimates;
}

/**
 * Skew Monitoring Manager
 * Manages tone-mark collection and skew estimation
 */
export class SkewMonitoringManager {
  private toneMarks: ToneMark[] = [];
  private skewEstimates: SkewEstimate[] = [];
  private syncStatus: SyncStatus | null = null;
  private avgLatency: number = 0;
  private onStatusUpdate?: (status: SyncStatus) => void;
  private collectionInterval: NodeJS.Timeout | null = null;
  private analysisInterval: NodeJS.Timeout | null = null;

  constructor(
    private collectionIntervalMs: number = 2000, // Collect every 2 seconds
    private analysisIntervalMs: number = 5000 // Analyze every 5 seconds
  ) {}

  /**
   * Add tone mark from listener
   */
  addToneMark(mark: ToneMark): void {
    this.toneMarks.push(mark);

    // Keep only recent tone marks (last 30 seconds)
    const cutoff = Date.now() - 30000;
    this.toneMarks = this.toneMarks.filter(m => m.timestamp > cutoff);
  }

  /**
   * Set average latency for threshold determination
   */
  setAverageLatency(latency: number): void {
    this.avgLatency = latency;
  }

  /**
   * Analyze tone marks and calculate skew
   */
  analyze(): void {
    if (this.toneMarks.length === 0) {
      return;
    }

    // Estimate skew
    this.skewEstimates = estimateSkew(this.toneMarks);

    // Calculate sync status
    this.syncStatus = calculateSyncStatus(this.skewEstimates, this.avgLatency);

    // Notify listeners
    if (this.syncStatus) {
      this.onStatusUpdate?.(this.syncStatus);
    }
  }

  /**
   * Start monitoring
   */
  start(onStatusUpdate: (status: SyncStatus) => void): void {
    this.onStatusUpdate = onStatusUpdate;

    // Analyze periodically
    this.analysisInterval = setInterval(() => {
      this.analyze();
    }, this.analysisIntervalMs);

    // Initial analysis
    this.analyze();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }
    this.onStatusUpdate = undefined;
  }

  /**
   * Get current sync status
   */
  getSyncStatus(): SyncStatus | null {
    return this.syncStatus;
  }

  /**
   * Get skew estimates
   */
  getSkewEstimates(): SkewEstimate[] {
    return [...this.skewEstimates];
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.toneMarks = [];
    this.skewEstimates = [];
    this.syncStatus = null;
  }
}

