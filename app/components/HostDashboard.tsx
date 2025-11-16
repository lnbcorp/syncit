'use client';

import { useEffect, useRef, useState } from 'react';
import { formatRoomCode } from '@/app/lib/room-code';
import { useAudioCapture } from '@/app/hooks/useAudioCapture';
import { useWebRTC } from '@/app/hooks/useWebRTC';
import { getAudioTrack } from '@/app/lib/audio-capture';
import { SkewMonitoringManager, type SyncStatus } from '@/app/lib/skew-monitoring';
import { useMetrics } from '@/app/hooks/useMetrics';
import type { WebRTCMetrics } from '@/app/lib/webrtc-stats';

interface HostDashboardProps {
  roomCode: string;
  listenerCount?: number;
  latency?: number;
  onStartBroadcast?: (stream: MediaStream) => void;
  onEndRoom?: () => void;
  onCopyCode?: () => void;
}

export default function HostDashboard({
  roomCode,
  listenerCount = 0,
  latency,
  onStartBroadcast,
  onEndRoom,
  onCopyCode,
}: HostDashboardProps) {
  // Get token and peerId from sessionStorage
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('roomToken') : null;
  const peerId = typeof window !== 'undefined' ? sessionStorage.getItem('peerId') : null;

  // Skew monitoring state
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const skewMonitoringRef = useRef<SkewMonitoringManager | null>(null);
  
  // Room metrics state
  const [roomMetrics, setRoomMetrics] = useState<any>(null);

  // Initialize WebRTC connection (only if we have token and peerId)
  const webRTCResult = useWebRTC({
    role: 'host',
    roomCode,
    peerId: peerId || '',
    token: token || '',
    onError: (error) => {
      console.error('WebRTC error:', error);
      alert(`WebRTC error: ${error.message}`);
    },
    // Handle tone marks from listeners for skew monitoring
    onWebSocketMessage: (message: any) => {
      if (message.type === 'tone_mark' && message.payload) {
        const { listenerPeerId, timestamp, sequence, serverTimestamp } = message.payload;
        if (skewMonitoringRef.current) {
          skewMonitoringRef.current.addToneMark({
            listenerPeerId,
            timestamp,
            sequence: sequence || 0,
            serverTimestamp,
          });
        }
      } else if (message.type === 'room_metrics' && message.payload) {
        // Handle room-level aggregated metrics
        setRoomMetrics(message.payload);
      }
    },
  });

  // Destructure after hook is called to ensure all values are available
  const { publishAudioTrack, unpublishAudioTrack, isConnected, connectionState, sendWebSocketMessage, getPeerConnection } = webRTCResult;

  const {
    isCapturing,
    audioSource,
    isMuted,
    constraints,
    stream,
    startCapture,
    stopCapture,
    toggleMute,
    updateConstraints,
    switchSource,
  } = useAudioCapture({
    onError: (error) => {
      console.error('Audio capture error:', error);
      // Format error message for better display
      let errorMessage: string;
      if (error.message.includes('No audio track available')) {
        const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
        if (isMac) {
          errorMessage = 'Audio sharing not available.\n\n' +
            'On macOS, try:\n' +
            '• Use Chrome or Edge (Safari may not support audio sharing)\n' +
            '• Select a tab/app that is currently playing audio\n' +
            '• Look for "Share audio" option in the dialog (if available)';
        } else {
          errorMessage = 'Audio sharing not enabled.\n\nPlease check the "Share audio" checkbox when selecting your screen/tab.';
        }
      } else {
        errorMessage = `Audio capture error: ${error.message}`;
      }
      alert(errorMessage);
    },
  });

  // Initialize skew monitoring
  useEffect(() => {
    if (!skewMonitoringRef.current) {
      skewMonitoringRef.current = new SkewMonitoringManager(2000, 5000);
      skewMonitoringRef.current.start((status) => {
        setSyncStatus(status);
      });
    }

    // Update average latency for threshold determination
    if (latency !== undefined && skewMonitoringRef.current) {
      skewMonitoringRef.current.setAverageLatency(latency);
    }

    return () => {
      if (skewMonitoringRef.current) {
        skewMonitoringRef.current.stop();
      }
    };
  }, [latency]);

  // Collect and send WebRTC metrics
  // Use a ref to store the peer connection to avoid calling getPeerConnection during render
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  
  useEffect(() => {
    // Update ref when connection is available
    if (getPeerConnection) {
      const pc = getPeerConnection();
      peerConnectionRef.current = pc;
    } else {
      peerConnectionRef.current = null;
    }
  }, [isConnected, connectionState, getPeerConnection]);

  useMetrics({
    peerConnection: peerConnectionRef.current,
    isEnabled: isCapturing && isConnected,
    onMetrics: (metrics: WebRTCMetrics) => {
      // Send metrics to server via WebSocket
      sendWebSocketMessage({
        type: 'metrics',
        payload: metrics,
      });
    },
    interval: 3000, // 3 seconds (within 2-5 second range)
  });

  // Publish audio track when stream is available and WebRTC is connected
  useEffect(() => {
    if (stream && isConnected && connectionState === 'connected') {
      const audioTrack = getAudioTrack(stream);
      if (audioTrack) {
        publishAudioTrack(audioTrack, stream).catch((error) => {
          console.error('Failed to publish audio track:', error);
        });
      }
    }
  }, [stream, isConnected, connectionState, publishAudioTrack]);

  const handleStartBroadcast = async () => {
    try {
      const stream = await startCapture(audioSource);
      onStartBroadcast?.(stream);
    } catch (error) {
      console.error('Failed to start broadcast:', error);
    }
  };

  const handleStopBroadcast = async () => {
    try {
      await unpublishAudioTrack();
      stopCapture();
    } catch (error) {
      console.error('Failed to stop broadcast:', error);
      stopCapture(); // Still stop capture even if unpublish fails
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(formatRoomCode(roomCode));
    onCopyCode?.();
  };

  const getLatencyBadge = () => {
    if (latency === undefined) return null;
    
    if (latency <= 50) {
      return { text: 'Good', color: 'bg-green-500' };
    } else if (latency <= 120) {
      return { text: 'Fair', color: 'bg-yellow-500' };
    } else {
      return { text: 'Poor', color: 'bg-red-500' };
    }
  };

  const latencyBadge = getLatencyBadge();

  return (
    <div className="flex w-full max-w-md flex-col gap-6 px-4">
      {/* Room Header */}
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-foreground">Host Room</h1>
        <div className="mt-2 text-3xl font-mono font-semibold tracking-wider text-foreground">
          {formatRoomCode(roomCode)}
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-col gap-4 rounded-lg bg-foreground/5 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground/70">Listeners</span>
          <span className="text-lg font-semibold text-foreground">{listenerCount}</span>
        </div>
        {latency !== undefined && latencyBadge && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground/70">Latency</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground/70">~{latency} ms</span>
              <span className={`rounded px-2 py-1 text-xs font-semibold text-white ${latencyBadge.color}`}>
                {latencyBadge.text}
              </span>
            </div>
          </div>
        )}
        {syncStatus && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground/70">Sync</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground/70">{Math.round(syncStatus.skew)} ms</span>
              <span
                className={`rounded px-2 py-1 text-xs font-semibold text-white ${
                  syncStatus.status === 'good'
                    ? 'bg-green-500'
                    : syncStatus.status === 'fair'
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
                }`}
              >
                {syncStatus.status === 'good' ? 'Good' : syncStatus.status === 'fair' ? 'Fair' : 'Poor'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Audio Source Selector */}
      <div className="flex flex-col gap-2" role="group" aria-label="Audio source selection">
        <label className="text-sm font-medium text-foreground">Audio Source</label>
        <div className="flex gap-2" role="radiogroup" aria-label="Select audio source">
          <button
            onClick={() => switchSource('mic')}
            disabled={isCapturing}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              audioSource === 'mic'
                ? 'bg-green-500 text-white'
                : 'bg-foreground/10 text-foreground hover:bg-foreground/20'
            }`}
            aria-label="Use microphone as audio source"
            aria-pressed={audioSource === 'mic'}
            role="radio"
          >
            Microphone
          </button>
          <button
            onClick={() => switchSource('system')}
            disabled={isCapturing}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              audioSource === 'system'
                ? 'bg-green-500 text-white'
                : 'bg-foreground/10 text-foreground hover:bg-foreground/20'
            }`}
            aria-label="Use system or tab audio as audio source"
            aria-pressed={audioSource === 'system'}
            role="radio"
          >
            System/Tab
          </button>
        </div>
      </div>

      {/* Audio Processing Toggles (for microphone only) */}
      {audioSource === 'mic' && (
        <div className="flex flex-col gap-2 rounded-lg bg-foreground/5 p-3">
          <label className="text-xs font-medium text-foreground/70">Audio Processing</label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                checked={constraints.echoCancellation ?? true}
                onChange={(e) => updateConstraints({ echoCancellation: e.target.checked })}
                disabled={!isCapturing}
                className="rounded w-5 h-5 focus:outline-none focus:ring-2 focus:ring-green-500"
                aria-label="Enable echo cancellation"
              />
              <span className="text-foreground">Echo Cancellation (AEC)</span>
            </label>
            <label className="flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                checked={constraints.noiseSuppression ?? true}
                onChange={(e) => updateConstraints({ noiseSuppression: e.target.checked })}
                disabled={!isCapturing}
                className="rounded w-5 h-5 focus:outline-none focus:ring-2 focus:ring-green-500"
                aria-label="Enable noise suppression"
              />
              <span className="text-foreground">Noise Suppression (NS)</span>
            </label>
            <label className="flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                checked={constraints.autoGainControl ?? true}
                onChange={(e) => updateConstraints({ autoGainControl: e.target.checked })}
                disabled={!isCapturing}
                className="rounded w-5 h-5 focus:outline-none focus:ring-2 focus:ring-green-500"
                aria-label="Enable auto gain control"
              />
              <span className="text-foreground">Auto Gain Control (AGC)</span>
            </label>
          </div>
        </div>
      )}

      {/* Mute/Unmute Button */}
      {isCapturing && (
        <button
          onClick={toggleMute}
          className={`w-full rounded-lg px-6 py-3 text-white transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            isMuted
              ? 'bg-gray-500 hover:bg-gray-600 focus:ring-gray-500'
              : 'bg-green-500 hover:bg-green-600 focus:ring-green-500'
          }`}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={isMuted}
        >
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
      )}

      {/* Main Actions */}
      <div className="flex flex-col gap-3">
        {!isCapturing ? (
          <button
            onClick={handleStartBroadcast}
            className="w-full rounded-lg bg-green-500 px-6 py-3 text-white transition-colors hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
            aria-label="Start broadcasting audio"
          >
            Start Broadcast
          </button>
        ) : (
          <button
            onClick={handleStopBroadcast}
            className="w-full rounded-lg bg-red-500 px-6 py-3 text-white transition-colors hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 min-h-[44px]"
            aria-label="Stop broadcasting audio"
          >
            Stop Broadcast
          </button>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleCopyCode}
            className="flex-1 rounded-lg border border-foreground/20 bg-transparent px-4 py-2 text-foreground transition-colors hover:bg-foreground/10 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
            aria-label={`Copy room code ${formatRoomCode(roomCode)} to clipboard`}
          >
            Copy Code
          </button>
          <button
            onClick={onEndRoom}
            className="flex-1 rounded-lg border border-red-500/50 bg-transparent px-4 py-2 text-red-600 transition-colors hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:text-red-400 min-h-[44px]"
            aria-label="End room and disconnect all participants"
          >
            End Room
          </button>
        </div>
      </div>
    </div>
  );
}

