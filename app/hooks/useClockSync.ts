'use client';

import { useEffect, useRef, useCallback } from 'react';
import { ClockSyncManager, type ClockSyncResult } from '@/app/lib/clock-sync';
import { createTimeSyncRequest, type TimeSyncResponse } from '@/app/lib/datachannel-messages';

interface UseClockSyncOptions {
  isConnected: boolean; // WebSocket connection status
  sendWebSocketMessage: (message: any) => void;
  onClockSyncComplete?: (result: ClockSyncResult) => void;
  enableQuickSync?: boolean; // Enable 5 quick probes on connection, default true
}

/**
 * Hook for WebSocket-based clock synchronization
 * Sends 5 quick ping probes through WebSocket for server clock sync
 */
export function useClockSync({
  isConnected,
  sendWebSocketMessage,
  onClockSyncComplete,
  enableQuickSync = true,
}: UseClockSyncOptions) {
  const clockSyncManagerRef = useRef<ClockSyncManager | null>(null);
  const hasCompletedQuickSyncRef = useRef(false);

  // Initialize clock sync manager
  useEffect(() => {
    if (!clockSyncManagerRef.current) {
      clockSyncManagerRef.current = new ClockSyncManager((message) => {
        // Send time sync request through WebSocket
        sendWebSocketMessage({
          type: 'time_sync_request',
          payload: {
            clientTime: message.clientTime,
            messageId: message.messageId,
          },
        });
      });
    }
    return () => {
      if (clockSyncManagerRef.current) {
        clockSyncManagerRef.current.reset();
      }
    };
  }, [sendWebSocketMessage]);

  /**
   * Handle time sync response from WebSocket
   */
  const handleTimeSyncResponse = useCallback(
    (response: { payload: TimeSyncResponse }) => {
      if (clockSyncManagerRef.current && response.payload) {
        clockSyncManagerRef.current.handleResponse(response.payload);
      }
    },
    []
  );

  // Start quick clock sync when connected
  useEffect(() => {
    if (isConnected && enableQuickSync && !hasCompletedQuickSyncRef.current && clockSyncManagerRef.current) {
      clockSyncManagerRef.current.start((result) => {
        hasCompletedQuickSyncRef.current = true;
        onClockSyncComplete?.(result);
      });
    } else if (!isConnected) {
      // Reset quick sync flag when disconnected
      hasCompletedQuickSyncRef.current = false;
    }
  }, [isConnected, enableQuickSync, onClockSyncComplete]);

  return {
    handleTimeSyncResponse,
    hasCompletedSync: hasCompletedQuickSyncRef.current,
  };
}

