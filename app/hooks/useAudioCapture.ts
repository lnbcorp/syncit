'use client';

import { useState, useRef, useCallback } from 'react';
import {
  getMicrophoneStream,
  getSystemAudioStream,
  setTrackMuted,
  isTrackMuted,
  stopStream,
  getAudioTrack,
  type AudioConstraints,
} from '@/app/lib/audio-capture';

interface UseAudioCaptureOptions {
  onError?: (error: Error) => void;
}

export function useAudioCapture({ onError }: UseAudioCaptureOptions = {}) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [audioSource, setAudioSource] = useState<'mic' | 'system'>('mic');
  const [isMuted, setIsMuted] = useState(false);
  const [constraints, setConstraints] = useState<AudioConstraints>({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  /**
   * Start audio capture
   */
  const startCapture = useCallback(async (source: 'mic' | 'system' = audioSource) => {
    try {
      // Stop existing stream if any
      if (streamRef.current) {
        stopStream(streamRef.current);
      }

      let stream: MediaStream;
      if (source === 'mic') {
        stream = await getMicrophoneStream(constraints);
      } else {
        stream = await getSystemAudioStream();
      }

      streamRef.current = stream;
      trackRef.current = getAudioTrack(stream);
      setAudioSource(source);
      setIsCapturing(true);
      setIsMuted(false);

      return stream;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to start audio capture');
      onError?.(err);
      throw err;
    }
  }, [audioSource, constraints, onError]);

  /**
   * Stop audio capture
   */
  const stopCapture = useCallback(() => {
    if (streamRef.current) {
      stopStream(streamRef.current);
      streamRef.current = null;
      trackRef.current = null;
      setIsCapturing(false);
      setIsMuted(false);
    }
  }, []);

  /**
   * Toggle mute/unmute
   */
  const toggleMute = useCallback(() => {
    if (trackRef.current) {
      const newMutedState = !isTrackMuted(trackRef.current);
      setTrackMuted(trackRef.current, newMutedState);
      setIsMuted(newMutedState);
    }
  }, []);

  /**
   * Set mute state
   */
  const setMuted = useCallback((muted: boolean) => {
    if (trackRef.current) {
      setTrackMuted(trackRef.current, muted);
      setIsMuted(muted);
    }
  }, []);

  /**
   * Update audio constraints (for microphone)
   */
  const updateConstraints = useCallback(async (newConstraints: Partial<AudioConstraints>) => {
    const updatedConstraints = { ...constraints, ...newConstraints };
    setConstraints(updatedConstraints);

    // If currently capturing with mic, apply new constraints
    if (isCapturing && audioSource === 'mic' && trackRef.current) {
      try {
        await trackRef.current.applyConstraints({
          echoCancellation: updatedConstraints.echoCancellation,
          noiseSuppression: updatedConstraints.noiseSuppression,
          autoGainControl: updatedConstraints.autoGainControl,
          sampleRate: updatedConstraints.sampleRate,
          channelCount: updatedConstraints.channelCount,
        });
      } catch (error) {
        console.error('Failed to apply constraints:', error);
        onError?.(error instanceof Error ? error : new Error('Failed to apply constraints'));
      }
    }
  }, [constraints, isCapturing, audioSource, onError]);

  /**
   * Switch audio source
   */
  const switchSource = useCallback(async (source: 'mic' | 'system') => {
    if (isCapturing) {
      // Restart capture with new source
      await startCapture(source);
    } else {
      setAudioSource(source);
    }
  }, [isCapturing, startCapture]);

  return {
    isCapturing,
    audioSource,
    isMuted,
    constraints,
    stream: streamRef.current,
    track: trackRef.current,
    startCapture,
    stopCapture,
    toggleMute,
    setMuted,
    updateConstraints,
    switchSource,
  };
}

