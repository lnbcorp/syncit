'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { WebRTCClient, type WebRTCClientOptions } from '@/app/lib/webrtc-client';
import type { DataChannelMessage } from '@/app/lib/datachannel-messages';

interface UseWebRTCOptions {
  role: 'host' | 'listener';
  roomCode: string;
  peerId: string;
  token: string;
  wsUrl?: string;
  onTrack?: (event: RTCTrackEvent) => void;
  onError?: (error: Error) => void;
  onDataChannelMessage?: (message: DataChannelMessage) => void;
  onDataChannelOpen?: () => void;
  onDataChannelClose?: () => void;
  onTimeSyncResponse?: (response: any) => void;
  onConsumed?: (payload: { serverTimestamp: number; roomCreatedAt?: number }) => void;
  onWebSocketMessage?: (message: any) => void;
}

export function useWebRTC({
  role,
  roomCode,
  peerId,
  token,
  wsUrl,
  onTrack,
  onError,
  onDataChannelMessage,
  onDataChannelOpen,
  onDataChannelClose,
  onTimeSyncResponse,
  onConsumed,
  onWebSocketMessage,
}: UseWebRTCOptions) {
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState>('new');
  const webrtcClientRef = useRef<WebRTCClient | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isDataChannelOpen, setIsDataChannelOpen] = useState(false);

  // Initialize WebSocket connection (only if we have token and peerId)
  useEffect(() => {
    if (!token || !peerId) {
      console.warn('WebRTC: Missing token or peerId, skipping WebSocket connection');
      return;
    }

    // Determine WebSocket URL - use wss:// in production, ws:// in development
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrlToUse = wsUrl || `${protocol}//${window.location.host}/ws`;
    
    console.log('Connecting to WebSocket:', wsUrlToUse);
    const ws = new WebSocket(wsUrlToUse);

    ws.onopen = () => {
      console.log('WebSocket connected');
      // Authenticate
      ws.send(JSON.stringify({
        type: 'authenticate',
        payload: { token },
      }));
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        // Handle time sync response separately (for clock sync)
        if (message.type === 'time_sync_response') {
          onTimeSyncResponse?.(message);
        }

        // Forward all WebSocket messages to custom handler
        onWebSocketMessage?.(message);

        await handleWebSocketMessage(message);
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
        onError?.(error instanceof Error ? error : new Error('WebSocket message error'));
      }
    };

    ws.onerror = (error) => {
      // WebSocket error event doesn't provide much detail
      // The actual error will be visible in the onclose handler
      console.warn('WebSocket connection error. Check if the server is running.');
    };

    ws.onclose = (event) => {
      console.log('WebSocket disconnected', event.code, event.reason);
      setIsConnected(false);
      
      // Only show error if it wasn't a normal closure
      if (event.code !== 1000 && event.code !== 1001) {
        const errorMessage = event.code === 1006 
          ? 'WebSocket connection failed. Make sure the server is running with: npm run dev'
          : `WebSocket closed unexpectedly: ${event.code} ${event.reason || ''}`;
        console.warn(errorMessage);
        
        // Only call onError for non-normal closures and not for connection refused (1006)
        // Connection refused is common in development when server isn't running
        if (event.code !== 1006) {
          onError?.(new Error(errorMessage));
        }
      }
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, [token, peerId, wsUrl, onError]);

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback(async (message: any) => {
    const client = webrtcClientRef.current;
    if (!client) return;

    switch (message.type) {
      case 'authenticated':
        console.log('Authenticated via WebSocket');
        setIsConnected(true);
        // Join room
        if (wsRef.current) {
          wsRef.current.send(JSON.stringify({
            type: 'join_room',
            payload: { roomCode },
          }));
        }
        break;

      case 'room_joined':
        console.log('Joined room via WebSocket');
        // Initialize WebRTC connection
        await initializeWebRTC();
        break;

      case 'sdp_offer':
        if (role === 'listener') {
          const answer = await client.createAnswer(message.payload.sdp);
          // Send answer via WebSocket
          if (wsRef.current) {
            wsRef.current.send(JSON.stringify({
              type: 'sdp_answer',
              payload: {
                sdp: answer,
                targetPeerId: message.payload.fromPeerId,
              },
            }));
          }
        }
        break;

      case 'sdp_answer':
        if (role === 'host') {
          await client.setRemoteDescription(message.payload.sdp);
        }
        break;

      case 'ice_candidate':
        await client.addIceCandidate(message.payload.candidate);
        break;

      case 'consumed':
        // Listener received consumer info with server timestamp
        if (role === 'listener' && message.payload) {
          // Server timestamp is included in the consumed message
          // This will be used for playout alignment
          console.log('Audio consumption started with server timestamp:', message.payload.serverTimestamp);
          onConsumed?.({
            serverTimestamp: message.payload.serverTimestamp,
            roomCreatedAt: message.payload.roomCreatedAt,
          });
        }
        break;

      case 'host_handoff':
      case 'host_promoted':
        // Handle host handoff - reinitialize if needed
        console.log('Host handoff detected:', message.payload);
        break;

      case 'error':
        onError?.(new Error(message.error || 'WebSocket error'));
        break;

      default:
        console.log('Unhandled WebSocket message:', message.type);
    }
  }, [role, roomCode, onError]);

  // Initialize WebRTC client
  const initializeWebRTC = useCallback(async () => {
    try {
      const options: WebRTCClientOptions = {
        role,
        roomCode,
        peerId,
        onIceCandidate: (candidate) => {
          // Send ICE candidate via WebSocket
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'ice_candidate',
              payload: {
                candidate: candidate.toJSON(),
              },
            }));
          }
        },
        onConnectionStateChange: (state) => {
          setConnectionState(state);
          console.log('Connection state:', state);
        },
        onIceConnectionStateChange: (state) => {
          setIceConnectionState(state);
          console.log('ICE connection state:', state);
        },
        onTrack: (event) => {
          onTrack?.(event);
        },
        onError: (error) => {
          onError?.(error);
        },
        onDataChannelMessage: (message) => {
          onDataChannelMessage?.(message);
        },
        onDataChannelOpen: () => {
          setIsDataChannelOpen(true);
          onDataChannelOpen?.();
        },
        onDataChannelClose: () => {
          setIsDataChannelOpen(false);
          onDataChannelClose?.();
        },
      };

      const client = new WebRTCClient(options);
      await client.initialize();
      webrtcClientRef.current = client;

      // If host, create offer
      if (role === 'host') {
        const offer = await client.createOffer();
        // Send offer via WebSocket
        if (wsRef.current) {
          wsRef.current.send(JSON.stringify({
            type: 'sdp_offer',
            payload: {
              sdp: offer,
            },
          }));
        }
      }
    } catch (error) {
      console.error('Failed to initialize WebRTC:', error);
      onError?.(error instanceof Error ? error : new Error('WebRTC initialization failed'));
    }
  }, [role, roomCode, peerId, onTrack, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (webrtcClientRef.current) {
        webrtcClientRef.current.close();
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  /**
   * Publish audio track (for Host)
   */
  const publishAudioTrack = useCallback(async (track: MediaStreamTrack, stream: MediaStream) => {
    if (!webrtcClientRef.current) {
      throw new Error('WebRTC client not initialized');
    }
    await webrtcClientRef.current.publishAudioTrack(track, stream);
  }, []);

  /**
   * Unpublish audio track (for Host)
   */
  const unpublishAudioTrack = useCallback(async () => {
    if (!webrtcClientRef.current) {
      return;
    }
    await webrtcClientRef.current.unpublishAudioTrack();
  }, []);

  /**
   * Send WebSocket message
   */
  const sendWebSocketMessage = useCallback((message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  /**
   * Get peer connection for stats collection
   */
  const getPeerConnection = useCallback((): RTCPeerConnection | null => {
    return webrtcClientRef.current?.getPeerConnection() || null;
  }, []);

  return {
    webrtcClient: webrtcClientRef.current,
    connectionState,
    iceConnectionState,
    isConnected,
    isDataChannelOpen,
    publishAudioTrack,
    unpublishAudioTrack,
    sendWebSocketMessage,
    sendDataChannelMessage: (message: DataChannelMessage | any) => {
      webrtcClientRef.current?.sendDataChannelMessage(message);
    },
    getStats: () => webrtcClientRef.current?.getStats(),
    getPeerConnection,
  };
}

