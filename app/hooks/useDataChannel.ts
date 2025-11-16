'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { DataChannelMessage } from '@/app/lib/datachannel-messages';
import {
  createTimeSyncRequest,
  createHeartbeat,
  createHostHandoffRequest,
  calculateClockOffset,
  type TimeSyncResponse,
} from '@/app/lib/datachannel-messages';
import { ClockSyncManager, type ClockSyncResult } from '@/app/lib/clock-sync';

interface UseDataChannelOptions {
  isDataChannelOpen: boolean;
  sendMessage: (message: DataChannelMessage) => void;
  onMessage?: (message: DataChannelMessage) => void;
  onTimeSync?: (offset: number) => void;
  onClockSyncComplete?: (result: ClockSyncResult) => void;
  onHostHandoffRequest?: (newHostPeerId: string) => void;
  heartbeatInterval?: number; // ms, default 5000
  timeSyncInterval?: number; // ms, default 30000
  enableQuickSync?: boolean; // Enable 5 quick probes on connection, default true
}

/**
 * Hook for managing DataChannel control messages
 * Handles time sync, heartbeats, and host handoff
 */
export function useDataChannel({
  isDataChannelOpen,
  sendMessage,
  onMessage,
  onTimeSync,
  onClockSyncComplete,
  onHostHandoffRequest,
  heartbeatInterval = 5000,
  timeSyncInterval = 30000,
  enableQuickSync = true,
}: UseDataChannelOptions) {
  const heartbeatSequenceRef = useRef(0);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingTimeSyncRef = useRef<{ requestTime: number; messageId: string } | null>(null);
  const clockSyncManagerRef = useRef<ClockSyncManager | null>(null);
  const hasCompletedQuickSyncRef = useRef(false);

  /**
   * Send heartbeat message
   */
  const sendHeartbeat = useCallback(() => {
    if (!isDataChannelOpen) return;

    const sequence = heartbeatSequenceRef.current++;
    const heartbeat = createHeartbeat(sequence);
    sendMessage(heartbeat);
  }, [isDataChannelOpen, sendMessage]);

  /**
   * Send time sync request
   */
  const sendTimeSync = useCallback(() => {
    if (!isDataChannelOpen) return;

    const request = createTimeSyncRequest();
    pendingTimeSyncRef.current = {
      requestTime: Date.now(),
      messageId: request.messageId || '',
    };
    sendMessage(request);
  }, [isDataChannelOpen, sendMessage]);

  /**
   * Send host handoff request
   */
  const sendHostHandoffRequest = useCallback(
    (newHostPeerId: string, reason?: string) => {
      if (!isDataChannelOpen) {
        throw new Error('DataChannel is not open');
      }

      const request = createHostHandoffRequest(newHostPeerId, reason);
      sendMessage(request);
    },
    [isDataChannelOpen, sendMessage]
  );

  /**
   * Handle incoming messages
   */
  const handleMessage = useCallback(
    (message: DataChannelMessage) => {
      onMessage?.(message);

      switch (message.type) {
        case 'time_sync_response':
          {
            const response = message as TimeSyncResponse;
            
            // Handle quick sync probes
            if (clockSyncManagerRef.current) {
              clockSyncManagerRef.current.handleResponse(response);
            }
            
            // Handle regular time sync
            if (
              pendingTimeSyncRef.current &&
              response.messageId === pendingTimeSyncRef.current.messageId
            ) {
              const offset = calculateClockOffset(response);
              onTimeSync?.(offset);
              pendingTimeSyncRef.current = null;
            }
          }
          break;

        case 'host_handoff_request':
          {
            const request = message as any;
            onHostHandoffRequest?.(request.newHostPeerId);
          }
          break;

        default:
          // Other message types are handled by the WebRTC client
          break;
      }
    },
    [onMessage, onTimeSync, onHostHandoffRequest]
  );

  // Initialize clock sync manager
  useEffect(() => {
    if (!clockSyncManagerRef.current) {
      clockSyncManagerRef.current = new ClockSyncManager(sendMessage);
    }
    return () => {
      if (clockSyncManagerRef.current) {
        clockSyncManagerRef.current.reset();
      }
    };
  }, [sendMessage]);

  // Start heartbeat interval and quick clock sync
  useEffect(() => {
    if (isDataChannelOpen) {
      // Send initial heartbeat
      sendHeartbeat();

      // Set up heartbeat interval
      heartbeatIntervalRef.current = setInterval(() => {
        sendHeartbeat();
      }, heartbeatInterval);

      // Set up time sync interval
      timeSyncIntervalRef.current = setInterval(() => {
        sendTimeSync();
      }, timeSyncInterval);

      // Start 5 quick ping probes for clock synchronization
      if (enableQuickSync && !hasCompletedQuickSyncRef.current && clockSyncManagerRef.current) {
        clockSyncManagerRef.current.start((result) => {
          hasCompletedQuickSyncRef.current = true;
          onClockSyncComplete?.(result);
          // Also call onTimeSync with the calculated offset
          onTimeSync?.(result.offset);
        });
      } else {
        // Send initial time sync (fallback if quick sync disabled)
        sendTimeSync();
      }
    } else {
      // Reset quick sync flag when DataChannel closes
      hasCompletedQuickSyncRef.current = false;
      
      // Clear intervals when DataChannel closes
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (timeSyncIntervalRef.current) {
        clearInterval(timeSyncIntervalRef.current);
        timeSyncIntervalRef.current = null;
      }
    }

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      if (timeSyncIntervalRef.current) {
        clearInterval(timeSyncIntervalRef.current);
      }
    };
  }, [isDataChannelOpen, heartbeatInterval, timeSyncInterval, enableQuickSync, sendHeartbeat, sendTimeSync, onClockSyncComplete, onTimeSync]);

  return {
    sendHeartbeat,
    sendTimeSync,
    sendHostHandoffRequest,
    handleMessage,
  };
}

