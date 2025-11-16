'use client';

import { useEffect, useRef, useCallback } from 'react';
import { collectWebRTCMetrics, type WebRTCMetrics } from '@/app/lib/webrtc-stats';

interface UseMetricsOptions {
  peerConnection: RTCPeerConnection | null;
  isEnabled: boolean;
  onMetrics: (metrics: WebRTCMetrics) => void;
  interval?: number; // ms, default 3000 (3 seconds)
}

/**
 * Hook for collecting WebRTC metrics periodically
 */
export function useMetrics({
  peerConnection,
  isEnabled,
  onMetrics,
  interval = 3000, // Default 3 seconds (between 2-5 seconds as per requirements)
}: UseMetricsOptions) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Collect and send metrics
   */
  const collectMetrics = useCallback(async () => {
    if (!isEnabled || !peerConnection) {
      return;
    }

    const metrics = await collectWebRTCMetrics(peerConnection);
    if (metrics) {
      onMetrics(metrics);
    }
  }, [isEnabled, peerConnection, onMetrics]);

  // Start collecting metrics periodically
  useEffect(() => {
    if (isEnabled && peerConnection) {
      // Collect initial metrics
      collectMetrics();

      // Set up interval
      intervalRef.current = setInterval(() => {
        collectMetrics();
      }, interval);
    } else {
      // Clear interval when disabled
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isEnabled, peerConnection, interval, collectMetrics]);

  return {
    collectMetrics,
  };
}

