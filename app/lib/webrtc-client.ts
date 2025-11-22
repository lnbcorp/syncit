/**
 * WebRTC Client Manager
 * Handles RTCPeerConnection setup, ICE candidates, and SDP exchange
 */

import { getRTCConfig, type RTCConfig } from './rtc-config';
import { mungeSDPForOpus, mungeSDPForReception, applyBitrateConstraints, type OpusConfig } from './sdp-munging';
import { configureAudioTrackForReception, type AudioReceptionConfig } from './audio-reception';
import {
  parseDataChannelMessage,
  type DataChannelMessage,
  type TimeSyncRequest,
  type TimeSyncResponse,
  type HeartbeatMessage,
  type HeartbeatAck,
  type HostHandoffRequest,
  type HostHandoffResponse,
} from './datachannel-messages';

export interface WebRTCClientOptions {
  role: 'host' | 'listener';
  roomCode: string;
  peerId: string;
  onIceCandidate?: (candidate: RTCIceCandidate) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onIceConnectionStateChange?: (state: RTCIceConnectionState) => void;
  onTrack?: (event: RTCTrackEvent) => void;
  onError?: (error: Error) => void;
  opusConfig?: OpusConfig;
  onDataChannelMessage?: (message: DataChannelMessage) => void;
  onDataChannelOpen?: () => void;
  onDataChannelClose?: () => void;
}

export class WebRTCClient {
  private pc: RTCPeerConnection | null = null;
  private options: WebRTCClientOptions;
  private rtcConfig: RTCConfig | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private audioSender: RTCRtpSender | null = null;
  private opusConfig: OpusConfig;
  private receptionConfig: AudioReceptionConfig;

  constructor(options: WebRTCClientOptions) {
    this.options = options;
    this.opusConfig = options.opusConfig || {
      sampleRate: 48000,
      ptime: 5,
      maxptime: 10,
      fec: true,
      dtx: false,
      minBitrate: 32000,
      maxBitrate: 64000,
    };
    this.receptionConfig = {
      playoutDelayHint: 0.03, // 30ms
      jitterBufferTarget: 20, // 20ms
      volume: 1.0,
    };
  }

  /**
   * Initialize WebRTC peer connection
   */
  async initialize(): Promise<void> {
    try {
      // Get RTC configuration (with TURN credentials)
      this.rtcConfig = await getRTCConfig();

      // Create peer connection
      this.pc = new RTCPeerConnection(this.rtcConfig);

      // Set up event handlers
      this.setupEventHandlers();

      // Create data channel for control messages (time sync, heartbeats, etc.)
      // Reliable, ordered channel for control messages
      if (this.options.role === 'host' || this.options.role === 'listener') {
        this.dataChannel = this.pc.createDataChannel('control', {
          ordered: true, // Ensure message ordering
          maxRetransmits: 3, // Retry failed messages up to 3 times
          maxPacketLifeTime: 5000, // 5 second timeout for messages
        });
        this.setupDataChannelHandlers();
      }

      // Handle incoming data channel (for peer-to-peer connections)
      this.pc.ondatachannel = (event) => {
        if (event.channel.label === 'control') {
          this.dataChannel = event.channel;
          this.setupDataChannelHandlers();
        }
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to initialize WebRTC');
      this.options.onError?.(err);
      throw err;
    }
  }

  /**
   * Set up peer connection event handlers
   * DTLS-SRTP is automatically enabled by RTCPeerConnection
   * Browsers handle DTLS negotiation and certificate validation automatically
   */
  private setupEventHandlers(): void {
    if (!this.pc) return;

    // ICE candidate gathering
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.options.onIceCandidate?.(event.candidate);
      }
    };

    // Connection state changes
    this.pc.onconnectionstatechange = () => {
      if (this.pc) {
        const state = this.pc.connectionState;
        this.options.onConnectionStateChange?.(state);
        // Detect failed/closed states as errors
        // RTCPeerConnection doesn't have onerror, so we handle errors through state changes
        if (state === 'failed' || state === 'disconnected') {
          this.options.onError?.(new Error(`WebRTC connection ${state}`));
        }
      }
    };

    // ICE connection state changes
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc) {
        this.options.onIceConnectionStateChange?.(this.pc.iceConnectionState);
        // Also detect ICE connection failures as errors
        if (this.pc.iceConnectionState === 'failed' || this.pc.iceConnectionState === 'disconnected') {
          this.options.onError?.(new Error(`ICE connection ${this.pc.iceConnectionState}`));
        }
      }
    };

    // DTLS state monitoring (for security verification)
    // Note: DTLS state is not directly exposed in RTCPeerConnection API
    // but DTLS-SRTP is automatically used for all media streams
    // Certificate validation is handled by the browser automatically

    // Track events (for receiving remote streams)
    // All tracks are automatically encrypted via DTLS-SRTP
    this.pc.ontrack = (event) => {
      // Configure received audio track for low-latency reception
      if (event.track.kind === 'audio' && this.options.role === 'listener') {
        configureAudioTrackForReception(event.track, this.receptionConfig);
      }
      this.options.onTrack?.(event);
    };
  }

  /**
   * Set up data channel event handlers
   */
  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('Data channel opened');
      this.options.onDataChannelOpen?.();
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel closed');
      this.options.onDataChannelClose?.();
    };

    this.dataChannel.onerror = (error) => {
      console.error('Data channel error:', error);
      this.options.onError?.(new Error('Data channel error'));
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const message = parseDataChannelMessage(event.data);
        if (message) {
          // Forward parsed message to handler
          this.options.onDataChannelMessage?.(message);
          // Also handle internally for automatic responses
          this.handleDataChannelMessage(message);
        }
      } catch (error) {
        console.error('Failed to parse data channel message:', error);
      }
    };
  }

  /**
   * Handle incoming DataChannel messages and send automatic responses
   */
  private handleDataChannelMessage(message: DataChannelMessage): void {
    switch (message.type) {
      case 'time_sync_request':
        // Respond to time sync request (if we're acting as server)
        // In peer-to-peer, this would be handled by the SFU or signaling server
        // For now, we just log it
        console.log('Time sync request received:', message);
        break;

      case 'time_sync_response':
        // Time sync response received - client should calculate offset
        console.log('Time sync response received:', message);
        break;

      case 'heartbeat':
        // Respond to heartbeat
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          const ack: HeartbeatAck = {
            type: 'heartbeat_ack',
            timestamp: Date.now(),
            sequence: (message as HeartbeatMessage).sequence,
          };
          this.sendDataChannelMessage(ack);
        }
        break;

      case 'heartbeat_ack':
        // Heartbeat acknowledged
        console.log('Heartbeat acknowledged:', message);
        break;

      case 'host_handoff_request':
        // Host handoff request - should be handled by application logic
        console.log('Host handoff request received:', message);
        break;

      case 'host_handoff_response':
        // Host handoff response - should be handled by application logic
        console.log('Host handoff response received:', message);
        break;

      case 'host_handoff_ack':
        // Host handoff acknowledged
        console.log('Host handoff acknowledged:', message);
        break;

      default:
        console.warn('Unknown DataChannel message type:', message);
    }
  }

  /**
   * Create SDP offer (for Host)
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }

    try {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: false, // Host sends, doesn't receive
      });

      // Munge SDP to enforce Opus configuration
      if (offer.sdp) {
        offer.sdp = mungeSDPForOpus(offer.sdp, this.opusConfig);
      }

      await this.pc.setLocalDescription(offer);
      return offer;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to create offer');
      this.options.onError?.(err);
      throw err;
    }
  }

  /**
   * Create SDP answer (for Listener/SFU)
   * Configured for receive-only audio with low-latency settings
   */
  async createAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }

    try {
      await this.pc.setRemoteDescription(offer);
      const answer = await this.pc.createAnswer({
        offerToReceiveAudio: true, // Listener receives audio
        offerToReceiveVideo: false, // No video
      });

      // Munge SDP for receive-only configuration (if needed)
      // For listeners, we want to ensure we accept Opus with low-latency settings
      if (answer.sdp) {
        answer.sdp = mungeSDPForReception(answer.sdp);
      }

      await this.pc.setLocalDescription(answer);
      return answer;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to create answer');
      this.options.onError?.(err);
      throw err;
    }
  }

  /**
   * Set remote description (for Host receiving answer)
   */
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }

    try {
      await this.pc.setRemoteDescription(description);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to set remote description');
      this.options.onError?.(err);
      throw err;
    }
  }

  /**
   * Add ICE candidate
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }

    try {
      await this.pc.addIceCandidate(candidate);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to add ICE candidate');
      this.options.onError?.(err);
      throw err;
    }
  }

  /**
   * Add local audio track (for Host)
   * Publishes audio track with Opus configuration and bitrate constraints
   */
  async publishAudioTrack(track: MediaStreamTrack, stream: MediaStream): Promise<void> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }

    // Remove existing audio track if any
    if (this.audioSender) {
      this.pc.removeTrack(this.audioSender);
      this.audioSender = null;
    }

    // Add new track
    this.audioSender = this.pc.addTrack(track, stream);

    // Apply bitrate constraints
    if (this.opusConfig.minBitrate || this.opusConfig.maxBitrate) {
      try {
        await applyBitrateConstraints(
          this.audioSender,
          this.opusConfig.minBitrate,
          this.opusConfig.maxBitrate
        );
      } catch (error) {
        console.warn('Failed to apply bitrate constraints:', error);
        // Continue even if bitrate constraints fail
      }
    }
  }

  /**
   * Remove audio track (stop publishing)
   */
  async unpublishAudioTrack(): Promise<void> {
    if (!this.pc || !this.audioSender) {
      return;
    }

    this.pc.removeTrack(this.audioSender);
    this.audioSender = null;
  }

  /**
   * Get audio sender (for updating constraints)
   */
  getAudioSender(): RTCRtpSender | null {
    return this.audioSender;
  }

  /**
   * Add local audio track (for Host) - deprecated, use publishAudioTrack instead
   * @deprecated Use publishAudioTrack instead
   */
  addTrack(track: MediaStreamTrack, stream: MediaStream): void {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }

    this.pc.addTrack(track, stream);
  }

  /**
   * Get connection state
   */
  getConnectionState(): RTCPeerConnectionState | null {
    return this.pc?.connectionState || null;
  }

  /**
   * Get ICE connection state
   */
  getIceConnectionState(): RTCIceConnectionState | null {
    return this.pc?.iceConnectionState || null;
  }

  /**
   * Get local description
   */
  getLocalDescription(): RTCSessionDescription | null {
    return this.pc?.localDescription || null;
  }

  /**
   * Get remote description
   */
  getRemoteDescription(): RTCSessionDescription | null {
    return this.pc?.remoteDescription || null;
  }

  /**
   * Get data channel
   */
  getDataChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  /**
   * Send message via data channel
   */
  sendDataChannelMessage(message: DataChannelMessage | any): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        const json = typeof message === 'string' ? message : JSON.stringify(message);
        this.dataChannel.send(json);
      } catch (error) {
        console.error('Failed to send DataChannel message:', error);
        this.options.onError?.(new Error('Failed to send DataChannel message'));
      }
    } else {
      console.warn('Data channel not open, readyState:', this.dataChannel?.readyState);
    }
  }

  /**
   * Check if data channel is open
   */
  isDataChannelOpen(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  /**
   * Close peer connection
   */
  close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }

  /**
   * Get peer connection stats
   */
  async getStats(): Promise<RTCStatsReport | null> {
    if (!this.pc) {
      return null;
    }

    try {
      return await this.pc.getStats();
    } catch (error) {
      console.error('Failed to get stats:', error);
      return null;
    }
  }

  /**
   * Get peer connection instance (for metrics collection)
   */
  getPeerConnection(): RTCPeerConnection | null {
    return this.pc;
  }
}

