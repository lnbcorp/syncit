/**
 * Room-Level Metrics Aggregator
 * Aggregates client metrics to calculate room-level statistics
 */

import { getRoomParticipants } from '../app/lib/room-store';
import type { ClientConnection } from './websocket';

export interface RoomMetrics {
  roomCode: string;
  timestamp: number;
  participantCount: number;
  latency: {
    p50: number | null;
    p95: number | null;
    min: number | null;
    max: number | null;
    avg: number | null;
  };
  jitter: {
    p50: number | null;
    p95: number | null;
    avg: number | null;
  };
  packetLoss: {
    percentage: number | null;
    totalPacketsLost: number | null;
    totalPacketsReceived: number | null;
  };
  skew: {
    maxSkew: number | null;
    avgSkew: number | null;
    listenerCount: number;
  };
  events: {
    joins: number;
    leaves: number;
    lastJoinTime: number | null;
    lastLeaveTime: number | null;
  };
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sortedValues[lower];
  }

  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Calculate statistics from array of numbers
 */
function calculateStats(values: number[]): {
  p50: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
} {
  if (values.length === 0) {
    return {
      p50: null,
      p95: null,
      min: null,
      max: null,
      avg: null,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);

  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sorted.reduce((sum, val) => sum + val, 0) / sorted.length,
  };
}

/**
 * Aggregate room metrics from client connections
 */
export function aggregateRoomMetrics(
  roomCode: string,
  connections: ClientConnection[],
  joinLeaveEvents: { type: 'join' | 'leave'; timestamp: number }[] = []
): RoomMetrics {
  const now = Date.now();

  // Collect RTT values from connections
  const rttValues: number[] = [];
  const jitterValues: number[] = [];
  const packetLossValues: { lost: number; received: number }[] = [];

  for (const conn of connections) {
    if (conn.metrics) {
      // RTT (latency)
      if (conn.metrics.rtt !== undefined && conn.metrics.rtt !== null) {
        rttValues.push(conn.metrics.rtt);
      }

      // Jitter
      if (conn.metrics.jitter !== undefined && conn.metrics.jitter !== null) {
        jitterValues.push(conn.metrics.jitter);
      }

      // Packet loss (we'll need to track packets received separately)
      // For now, we'll use packetsLost if available
      if (conn.metrics.packetsLost !== undefined && conn.metrics.packetsLost !== null) {
        // Estimate total packets (rough estimate based on jitterBufferEmittedCount)
        const totalPackets = conn.metrics.jitterBufferEmittedCount || 0;
        const lost = conn.metrics.packetsLost;
        if (totalPackets > 0 || lost > 0) {
          packetLossValues.push({
            lost,
            received: totalPackets,
          });
        }
      }
    }
  }

  // Calculate latency statistics
  const latencyStats = calculateStats(rttValues);

  // Calculate jitter statistics
  const jitterStats = calculateStats(jitterValues);
  const avgJitter = jitterValues.length > 0
    ? jitterValues.reduce((sum, val) => sum + val, 0) / jitterValues.length
    : null;

  // Calculate packet loss percentage
  let packetLossPercentage: number | null = null;
  let totalPacketsLost: number | null = null;
  let totalPacketsReceived: number | null = null;

  if (packetLossValues.length > 0) {
    totalPacketsLost = packetLossValues.reduce((sum, p) => sum + p.lost, 0);
    totalPacketsReceived = packetLossValues.reduce((sum, p) => sum + p.received, 0);
    const totalPackets = totalPacketsLost + totalPacketsReceived;
    if (totalPackets > 0) {
      packetLossPercentage = (totalPacketsLost / totalPackets) * 100;
    }
  }

  // Get skew estimates (would come from SkewMonitoringManager)
  // For now, we'll calculate a simple estimate from jitter buffer delays
  const jitterBufferDelays: number[] = [];
  for (const conn of connections) {
    if (conn.metrics?.jitterBufferDelay !== undefined && conn.metrics.jitterBufferDelay !== null) {
      jitterBufferDelays.push(conn.metrics.jitterBufferDelay);
    }
  }

  let maxSkew: number | null = null;
  let avgSkew: number | null = null;
  if (jitterBufferDelays.length > 1) {
    const sorted = [...jitterBufferDelays].sort((a, b) => a - b);
    maxSkew = sorted[sorted.length - 1] - sorted[0];
    avgSkew = sorted.reduce((sum, val) => sum + val, 0) / sorted.length;
  }

  // Count listeners
  const listenerCount = connections.filter(conn => conn.role === 'listener').length;

  // Process join/leave events
  const joins = joinLeaveEvents.filter(e => e.type === 'join').length;
  const leaves = joinLeaveEvents.filter(e => e.type === 'leave').length;
  const joinTimes = joinLeaveEvents.filter(e => e.type === 'join').map(e => e.timestamp);
  const leaveTimes = joinLeaveEvents.filter(e => e.type === 'leave').map(e => e.timestamp);
  const lastJoinTime = joinTimes.length > 0 ? Math.max(...joinTimes) : null;
  const lastLeaveTime = leaveTimes.length > 0 ? Math.max(...leaveTimes) : null;

  return {
    roomCode,
    timestamp: now,
    participantCount: connections.length,
    latency: latencyStats,
    jitter: {
      ...jitterStats,
      avg: avgJitter,
    },
    packetLoss: {
      percentage: packetLossPercentage,
      totalPacketsLost,
      totalPacketsReceived,
    },
    skew: {
      maxSkew,
      avgSkew,
      listenerCount,
    },
    events: {
      joins,
      leaves,
      lastJoinTime,
      lastLeaveTime,
    },
  };
}

/**
 * Metrics Aggregator Manager
 * Manages room-level metrics aggregation
 */
export class MetricsAggregator {
  private joinLeaveEvents: Map<string, { type: 'join' | 'leave'; timestamp: number }[]> = new Map();
  private aggregationInterval: NodeJS.Timeout | null = null;
  private onMetricsUpdate?: (metrics: RoomMetrics) => void;

  /**
   * Record join event
   */
  recordJoin(roomCode: string): void {
    if (!this.joinLeaveEvents.has(roomCode)) {
      this.joinLeaveEvents.set(roomCode, []);
    }
    this.joinLeaveEvents.get(roomCode)!.push({
      type: 'join',
      timestamp: Date.now(),
    });
  }

  /**
   * Record leave event
   */
  recordLeave(roomCode: string): void {
    if (!this.joinLeaveEvents.has(roomCode)) {
      this.joinLeaveEvents.set(roomCode, []);
    }
    this.joinLeaveEvents.get(roomCode)!.push({
      type: 'leave',
      timestamp: Date.now(),
    });
  }

  /**
   * Get join/leave events for a room
   */
  getEvents(roomCode: string): { type: 'join' | 'leave'; timestamp: number }[] {
    return this.joinLeaveEvents.get(roomCode) || [];
  }

  /**
   * Start aggregation for a room
   */
  start(
    roomCode: string,
    getConnections: () => ClientConnection[],
    onUpdate: (metrics: RoomMetrics) => void,
    interval: number = 10000 // 10 seconds
  ): void {
    this.onMetricsUpdate = onUpdate;

    // Aggregate immediately
    this.aggregate(roomCode, getConnections);

    // Set up periodic aggregation
    this.aggregationInterval = setInterval(() => {
      this.aggregate(roomCode, getConnections);
    }, interval);
  }

  /**
   * Stop aggregation
   */
  stop(): void {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
  }

  /**
   * Aggregate metrics for a room
   */
  aggregate(roomCode: string, getConnections: () => ClientConnection[]): void {
    const connections = getConnections();
    const events = this.getEvents(roomCode);
    const metrics = aggregateRoomMetrics(roomCode, connections, events);
    this.onMetricsUpdate?.(metrics);
  }

  /**
   * Clear events for a room (cleanup)
   */
  clearEvents(roomCode: string): void {
    this.joinLeaveEvents.delete(roomCode);
  }
}

// Export singleton instance
export const metricsAggregator = new MetricsAggregator();

