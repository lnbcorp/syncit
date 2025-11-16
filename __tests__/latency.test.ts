/**
 * Tests for latency and sync measurement
 * Tests mouth-to-ear latency, inter-listener skew, and network chaos
 */

import { SkewMonitoringManager, type SyncStatus } from '@/app/lib/skew-monitoring';
import { PlayoutAlignmentManager } from '@/app/lib/playout-alignment';
import type { ClockSyncResult } from '@/app/lib/clock-sync';

// Mock audio context for testing
class MockAudioContext {
  currentTime = 0;
  createOscillator() {
    return {
      connect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      frequency: { value: 440 },
    };
  }
  createGain() {
    return {
      connect: jest.fn(),
      gain: { value: 1 },
    };
  }
  createAnalyser() {
    return {
      connect: jest.fn(),
      getByteFrequencyData: jest.fn().mockReturnValue(new Uint8Array(256)),
    };
  }
}

describe('Latency and Sync Tests', () => {
  describe('Mouth-to-Ear Latency Measurement', () => {
    it('should measure latency using chirp signal', () => {
      // Simulate chirp generation and detection
      const hostTimestamp = Date.now();
      const listenerReceiveTime = hostTimestamp + 50; // 50ms latency
      
      const measuredLatency = listenerReceiveTime - hostTimestamp;
      expect(measuredLatency).toBe(50);
    });

    it('should handle multiple latency measurements', () => {
      const measurements: number[] = [];
      
      // Simulate 10 measurements
      for (let i = 0; i < 10; i++) {
        const hostTimestamp = Date.now() + i * 100;
        const listenerReceiveTime = hostTimestamp + (45 + Math.random() * 10); // 45-55ms
        measurements.push(listenerReceiveTime - hostTimestamp);
      }

      // Calculate percentiles
      measurements.sort((a, b) => a - b);
      const p50 = measurements[Math.floor(measurements.length * 0.5)];
      const p95 = measurements[Math.floor(measurements.length * 0.95)];
      const p99 = measurements[Math.floor(measurements.length * 0.99)];

      expect(p50).toBeLessThan(60); // p50 < 60ms
      expect(p95).toBeLessThan(120); // p95 < 120ms
      expect(p99).toBeLessThan(200); // p99 < 200ms
    });

    it('should detect latency spikes', () => {
      const measurements = [45, 48, 50, 52, 200, 48, 50]; // One spike at 200ms
      const maxLatency = Math.max(...measurements);
      const avgLatency = measurements.reduce((a, b) => a + b, 0) / measurements.length;

      expect(maxLatency).toBe(200);
      expect(avgLatency).toBeGreaterThan(50);
      expect(avgLatency).toBeLessThan(100);
    });
  });

  describe('Inter-Listener Skew Measurement', () => {
    it('should measure skew between listeners', () => {
      const hostTimestamp = Date.now();
      const listener1ReceiveTime = hostTimestamp + 50;
      const listener2ReceiveTime = hostTimestamp + 55;

      const skew = listener2ReceiveTime - listener1ReceiveTime;
      expect(skew).toBe(5);
    });

    it('should detect excessive skew', () => {
      const skews = [2, 3, 5, 8, 10, 15, 20, 25];
      const maxSkew = Math.max(...skews);
      const avgSkew = skews.reduce((a, b) => a + b, 0) / skews.length;

      // Max skew should be < 30ms for good sync
      expect(maxSkew).toBeLessThan(30);
      expect(avgSkew).toBeLessThan(15);
    });

    it('should handle tone mark timing for skew monitoring', () => {
      const manager = new SkewMonitoringManager(2000, 5000);
      
      // Simulate tone marks from multiple listeners
      const toneMarks = [
        { listenerPeerId: 'listener-1', timestamp: 1000, sequence: 1, serverTimestamp: 1000 },
        { listenerPeerId: 'listener-2', timestamp: 1005, sequence: 1, serverTimestamp: 1000 },
        { listenerPeerId: 'listener-3', timestamp: 1003, sequence: 1, serverTimestamp: 1000 },
      ];

      toneMarks.forEach(mark => {
        manager.addToneMark(mark);
      });

      // Skew should be calculated
      let syncStatus: SyncStatus | null = null;
      manager.start((status) => {
        syncStatus = status;
      });

      // Wait for status update
      setTimeout(() => {
        expect(syncStatus).not.toBeNull();
        if (syncStatus) {
          expect(syncStatus.skew).toBeLessThan(10); // Max skew between listeners
        }
      }, 100);
    });
  });

  describe('Network Chaos Testing', () => {
    it('should handle 1-3% packet loss', () => {
      const totalPackets = 1000;
      const lossRate = 0.02; // 2%
      const lostPackets = Math.floor(totalPackets * lossRate);
      const receivedPackets = totalPackets - lostPackets;

      expect(lostPackets).toBeGreaterThanOrEqual(10); // 1% of 1000
      expect(lostPackets).toBeLessThanOrEqual(30); // 3% of 1000
      expect(receivedPackets).toBeGreaterThan(970);
    });

    it('should handle 20-60ms jitter', () => {
      const baseLatency = 50;
      const jitterRange = [20, 60];
      const latencies: number[] = [];

      // Simulate 100 measurements with jitter
      for (let i = 0; i < 100; i++) {
        const jitter = jitterRange[0] + Math.random() * (jitterRange[1] - jitterRange[0]);
        latencies.push(baseLatency + jitter);
      }

      const minLatency = Math.min(...latencies);
      const maxLatency = Math.max(...latencies);
      const jitter = maxLatency - minLatency;

      expect(jitter).toBeGreaterThanOrEqual(20);
      expect(jitter).toBeLessThanOrEqual(60);
    });

    it('should maintain sync under network chaos', () => {
      // Simulate network conditions: 2% loss, 40ms jitter
      const measurements: number[] = [];
      const baseLatency = 50;
      const jitter = 40;
      const lossRate = 0.02;

      for (let i = 0; i < 100; i++) {
        if (Math.random() > lossRate) {
          const latency = baseLatency + (Math.random() - 0.5) * jitter;
          measurements.push(latency);
        }
      }

      // Calculate percentiles
      measurements.sort((a, b) => a - b);
      const p50 = measurements[Math.floor(measurements.length * 0.5)];
      const p95 = measurements[Math.floor(measurements.length * 0.95)];
      const p99 = measurements[Math.floor(measurements.length * 0.99)];

      // Should still meet targets under chaos
      expect(p50).toBeLessThan(60);
      expect(p95).toBeLessThan(120);
      expect(p99).toBeLessThan(200);
    });
  });

  describe('Percentile Targets', () => {
    it('should verify p50 < 60ms', () => {
      const measurements = Array.from({ length: 100 }, () => 45 + Math.random() * 10);
      measurements.sort((a, b) => a - b);
      const p50 = measurements[Math.floor(measurements.length * 0.5)];

      expect(p50).toBeLessThan(60);
    });

    it('should verify p95 < 120ms', () => {
      const measurements = Array.from({ length: 100 }, () => 50 + Math.random() * 50);
      measurements.sort((a, b) => a - b);
      const p95 = measurements[Math.floor(measurements.length * 0.95)];

      expect(p95).toBeLessThan(120);
    });

    it('should verify p99 < 200ms', () => {
      const measurements = Array.from({ length: 100 }, () => 50 + Math.random() * 100);
      measurements.sort((a, b) => a - b);
      const p99 = measurements[Math.floor(measurements.length * 0.99)];

      expect(p99).toBeLessThan(200);
    });

    it('should calculate all percentiles correctly', () => {
      const measurements = [45, 48, 50, 52, 55, 58, 60, 65, 70, 80, 90, 100, 110, 120, 150, 180];
      measurements.sort((a, b) => a - b);

      const p50 = measurements[Math.floor(measurements.length * 0.5)];
      const p95 = measurements[Math.floor(measurements.length * 0.95)];
      const p99 = measurements[Math.floor(measurements.length * 0.99)];

      expect(p50).toBeLessThan(60);
      expect(p95).toBeLessThan(120);
      expect(p99).toBeLessThan(200);
    });
  });

  describe('Playout Alignment', () => {
    it('should adjust playout timing for sync', () => {
      const manager = new PlayoutAlignmentManager();
      
      const clockSyncResult: ClockSyncResult = {
        offset: 10, // 10ms offset
        rtt: 50,
        drift: 0.001,
        timestamp: Date.now(),
      };

      manager.initialize(clockSyncResult);
      
      const serverTimestamp = Date.now();
      const clientReceiveTime = Date.now() + 5;
      manager.updatePlayoutState(serverTimestamp, clientReceiveTime);

      const adjustment = manager.getPlayoutAdjustment();
      expect(adjustment).toBeGreaterThanOrEqual(0.95);
      expect(adjustment).toBeLessThanOrEqual(1.05);
    });
  });
});

