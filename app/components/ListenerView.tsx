'use client';

import { useState, useEffect, useRef } from 'react';
import { formatRoomCode } from '@/app/lib/room-code';
import { AutoplayBlockedPrompt } from './ErrorStates';
import { useWebRTC } from '@/app/hooks/useWebRTC';
import { useClockSync } from '@/app/hooks/useClockSync';
import {
  setAudioSink,
  setAudioVolume,
  playAudio,
  pauseAudio,
  stopAudio,
  configureAudioTrackForReception,
} from '@/app/lib/audio-reception';
import { PlayoutAlignmentManager } from '@/app/lib/playout-alignment';
import { useToneMark } from '@/app/hooks/useToneMark';
import { useMetrics } from '@/app/hooks/useMetrics';
import type { WebRTCMetrics } from '@/app/lib/webrtc-stats';

interface ListenerViewProps {
  roomCode: string;
  listenerCount?: number;
  latency?: number;
  onLeaveRoom?: () => void;
  onEnableAudio?: () => void;
  onServerTimestamp?: (serverTimestamp: number, roomCreatedAt?: number) => void;
}

export default function ListenerView({
  roomCode,
  listenerCount = 0,
  latency,
  onLeaveRoom,
  onEnableAudio,
  onServerTimestamp,
}: ListenerViewProps) {
  const [volume, setVolume] = useState(1.0);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [showAutoplayPrompt, setShowAutoplayPrompt] = useState(false);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<string>('default');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playoutAlignmentRef = useRef<PlayoutAlignmentManager | null>(null);
  const handleTimeSyncResponseRef = useRef<((response: any) => void) | null>(null);

  // Get token and peerId from sessionStorage
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('roomToken') : null;
  const peerId = typeof window !== 'undefined' ? sessionStorage.getItem('peerId') : null;

  // Initialize WebRTC connection for listener
  const { isConnected, connectionState, webrtcClient, sendWebSocketMessage, getPeerConnection } = useWebRTC({
    role: 'listener',
    roomCode,
    peerId: peerId || '',
    token: token || '',
    onTrack: (event) => {
      // Handle incoming audio track
      if (event.track.kind === 'audio') {
        // Configure track for low-latency reception
        configureAudioTrackForReception(event.track);

        const stream = event.streams[0] || new MediaStream([event.track]);
        streamRef.current = stream;

        // Update audio element with new stream
        if (audioRef.current) {
          audioRef.current.srcObject = stream;
          setAudioVolume(audioRef.current, volume);
          
          // Set output device if already selected
          if (selectedOutput !== 'default') {
            setAudioSink(audioRef.current, selectedOutput).catch((err) => {
              console.error('Error setting audio output:', err);
            });
          }

          // Auto-play if audio is enabled
          if (isAudioEnabled) {
            playAudio(audioRef.current).catch((error) => {
              console.log('Autoplay blocked:', error);
              setShowAutoplayPrompt(true);
            });
          }
        }
      }
    },
    onTimeSyncResponse: (response) => {
      // Forward time sync response to clock sync handler
      if (handleTimeSyncResponseRef.current) {
        handleTimeSyncResponseRef.current(response);
      }
    },
    onConsumed: (payload) => {
      // Update playout alignment with server timestamp when audio consumption starts
      if (playoutAlignmentRef.current && payload.serverTimestamp) {
        const clientReceiveTime = Date.now();
        playoutAlignmentRef.current.updatePlayoutState(
          payload.serverTimestamp,
          clientReceiveTime
        );
      }
      onServerTimestamp?.(payload.serverTimestamp, payload.roomCreatedAt);
    },
    onError: (error) => {
      console.error('WebRTC error:', error);
    },
  });

  // Initialize clock sync and playout alignment
  const { handleTimeSyncResponse } = useClockSync({
    isConnected,
    sendWebSocketMessage: sendWebSocketMessage || (() => {}),
    onClockSyncComplete: (result) => {
      // Initialize playout alignment with clock sync result
      if (!playoutAlignmentRef.current) {
        playoutAlignmentRef.current = new PlayoutAlignmentManager();
      }
      playoutAlignmentRef.current.initialize(result);
    },
  });

  // Store handleTimeSyncResponse in ref for use in onTimeSyncResponse callback
  useEffect(() => {
    handleTimeSyncResponseRef.current = handleTimeSyncResponse;
  }, [handleTimeSyncResponse]);

  // Initialize playout alignment manager
  useEffect(() => {
    if (!playoutAlignmentRef.current) {
      playoutAlignmentRef.current = new PlayoutAlignmentManager();
    }

    return () => {
      if (playoutAlignmentRef.current) {
        playoutAlignmentRef.current.cleanup();
      }
    };
  }, []);

  // Apply playout alignment adjustments
  useEffect(() => {
    if (!audioRef.current || !playoutAlignmentRef.current || !isAudioEnabled) {
      return;
    }

    const interval = setInterval(() => {
      if (audioRef.current && playoutAlignmentRef.current) {
        const adjustment = playoutAlignmentRef.current.getPlayoutAdjustment();
        playoutAlignmentRef.current.applyPlayoutAdjustment(audioRef.current, adjustment);
      }
    }, 100); // Check every 100ms

    return () => {
      clearInterval(interval);
    };
  }, [isAudioEnabled]);

  // Send periodic tone marks for skew monitoring
  useToneMark({
    audioElement: audioRef.current,
    isEnabled: isAudioEnabled && isConnected,
    sendMessage: sendWebSocketMessage,
    interval: 2000, // Send every 2 seconds
  });

  // Collect and send WebRTC metrics
  useMetrics({
    peerConnection: getPeerConnection(),
    isEnabled: isAudioEnabled && isConnected,
    onMetrics: (metrics: WebRTCMetrics) => {
      // Send metrics to server via WebSocket
      sendWebSocketMessage({
        type: 'metrics',
        payload: metrics,
      });
    },
    interval: 3000, // 3 seconds (within 2-5 second range)
  });

  useEffect(() => {
    // Get available audio output devices
    const getAudioDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
        setOutputDevices(audioOutputs);
      } catch (error) {
        console.error('Error getting audio devices:', error);
      }
    };

    getAudioDevices();
  }, []);

  useEffect(() => {
    // Apply volume to audio element if it exists
    if (audioRef.current) {
      setAudioVolume(audioRef.current, volume);
    }
  }, [volume]);

  useEffect(() => {
    // Set audio output device if supported
    if (audioRef.current && selectedOutput !== 'default') {
      setAudioSink(audioRef.current, selectedOutput).catch((err) => {
        console.error('Error setting audio output:', err);
      });
    }
  }, [selectedOutput, audioRef.current]);

  useEffect(() => {
    // Play audio when enabled
    if (audioRef.current && isAudioEnabled && streamRef.current) {
      playAudio(audioRef.current)
        .then(() => {
          setShowAutoplayPrompt(false);
        })
        .catch((error) => {
          console.log('Autoplay blocked:', error);
          setShowAutoplayPrompt(true);
        });
    } else if (audioRef.current && !isAudioEnabled) {
      pauseAudio(audioRef.current);
    }
  }, [isAudioEnabled]);

  const handleEnableAudio = () => {
    setIsAudioEnabled(true);
    onEnableAudio?.();
  };

  const handleAutoplayEnable = () => {
    if (audioRef.current) {
      playAudio(audioRef.current)
        .then(() => {
          setShowAutoplayPrompt(false);
        })
        .catch((error) => {
          console.error('Failed to enable audio:', error);
        });
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        stopAudio(audioRef.current);
      }
    };
  }, []);

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
        <h1 className="text-2xl font-semibold text-foreground">Room</h1>
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
      </div>

             {/* Enable Audio Button (for autoplay policy) */}
             {!isAudioEnabled && (
               <button
                 onClick={handleEnableAudio}
                 className="w-full rounded-lg bg-green-500 px-6 py-3 text-white transition-colors hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                 aria-label="Enable audio playback"
               >
                 Enable Audio
               </button>
             )}

      {/* Audio Controls */}
      {isAudioEnabled && (
        <>
                 {/* Volume Control */}
                 <div className="flex flex-col gap-2">
                   <label htmlFor="volume-control" className="text-sm font-medium text-foreground">
                     Volume: {Math.round(volume * 100)}%
                   </label>
                   <input
                     id="volume-control"
                     type="range"
                     min="0"
                     max="1"
                     step="0.01"
                     value={volume}
                     onChange={(e) => setVolume(parseFloat(e.target.value))}
                     className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-foreground/20 accent-green-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                     aria-label={`Volume control, currently ${Math.round(volume * 100)} percent`}
                     aria-valuemin={0}
                     aria-valuemax={100}
                     aria-valuenow={Math.round(volume * 100)}
                   />
                   <div className="flex justify-between text-xs text-foreground/50" aria-hidden="true">
                     <span>0%</span>
                     <span>100%</span>
                   </div>
                 </div>

                 {/* Output Device Selector */}
                 {outputDevices.length > 0 && (
                   <div className="flex flex-col gap-2">
                     <label htmlFor="output-device-select" className="text-sm font-medium text-foreground">
                       Output Device
                     </label>
                     <select
                       id="output-device-select"
                       value={selectedOutput}
                       onChange={(e) => setSelectedOutput(e.target.value)}
                       className="rounded-lg border border-foreground/20 bg-transparent px-4 py-2 text-foreground focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                       aria-label="Select audio output device"
                     >
                       <option value="default">Default</option>
                       {outputDevices.map((device) => (
                         <option key={device.deviceId} value={device.deviceId}>
                           {device.label || `Device ${device.deviceId.slice(0, 8)}`}
                         </option>
                       ))}
                     </select>
                   </div>
                 )}
        </>
      )}

      {/* Hidden audio element for output routing */}
      <audio ref={audioRef} style={{ display: 'none' }} />

             {/* Leave Room Button */}
             <button
               onClick={onLeaveRoom}
               className="w-full rounded-lg border border-red-500/50 bg-transparent px-6 py-3 text-red-600 transition-colors hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:text-red-400 min-h-[44px]"
               aria-label="Leave room and return to home"
             >
               Leave Room
             </button>

      {/* Autoplay Blocked Prompt */}
      {showAutoplayPrompt && (
        <AutoplayBlockedPrompt
          onEnable={handleAutoplayEnable}
          onDismiss={() => setShowAutoplayPrompt(false)}
        />
      )}
    </div>
  );
}

