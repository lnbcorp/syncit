'use client';

import { useEffect, useRef, useCallback } from 'react';

interface UseToneMarkOptions {
  audioElement: HTMLAudioElement | null;
  isEnabled: boolean;
  sendMessage: (message: any) => void;
  interval?: number; // ms, default 2000
}

/**
 * Hook for generating and sending periodic tone marks
 * Listeners use this to send timing information for skew monitoring
 */
export function useToneMark({
  audioElement,
  isEnabled,
  sendMessage,
  interval = 2000,
}: UseToneMarkOptions) {
  const sequenceRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Send tone mark with current timestamp
   */
  const sendToneMark = useCallback(() => {
    if (!isEnabled || !audioElement) {
      return;
    }

    // Get current playback time as reference
    const currentTime = audioElement.currentTime * 1000; // Convert to ms
    const clientTimestamp = Date.now();

    // Send tone mark
    sendMessage({
      type: 'tone_mark',
      payload: {
        timestamp: clientTimestamp,
        sequence: sequenceRef.current++,
        playbackTime: currentTime,
      },
    });
  }, [isEnabled, audioElement, sendMessage]);

  // Start sending tone marks periodically
  useEffect(() => {
    if (isEnabled && audioElement) {
      // Send initial tone mark
      sendToneMark();

      // Set up interval
      intervalRef.current = setInterval(() => {
        sendToneMark();
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
  }, [isEnabled, audioElement, interval, sendToneMark]);

  return {
    sendToneMark,
  };
}

