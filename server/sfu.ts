/**
 * SFU Server using mediasoup
 * Handles audio routing from Host to multiple Listeners
 */

import * as mediasoup from 'mediasoup';
import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  Transport,
} from 'mediasoup/node/lib/types';

interface SFURoom {
  router: Router;
  hostTransport: WebRtcTransport | null;
  hostProducer: Producer | null;
  listenerTransports: Map<string, WebRtcTransport>;
  listenerConsumers: Map<string, Consumer>;
  createdAt: number; // Server timestamp when room was created
}

interface SFUConfig {
  numWorkers: number;
  rtcMinPort: number;
  rtcMaxPort: number;
  listenIp: string;
  announcedIp?: string;
}

const DEFAULT_CONFIG: SFUConfig = {
  numWorkers: 1, // Single worker for simplicity
  rtcMinPort: 40000,
  rtcMaxPort: 49999,
  listenIp: '0.0.0.0',
  announcedIp: undefined, // Will be detected automatically
};

export class SFUServer {
  private workers: Worker[] = [];
  private rooms: Map<string, SFURoom> = new Map();
  private config: SFUConfig;
  private nextWorkerIndex: number = 0;

  constructor(config: Partial<SFUConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize mediasoup workers
   */
  async initialize(): Promise<void> {
    console.log('Initializing mediasoup workers...');

    // Create workers
    for (let i = 0; i < this.config.numWorkers; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: 'warn',
        logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
        rtcMinPort: this.config.rtcMinPort,
        rtcMaxPort: this.config.rtcMaxPort,
      });

      worker.on('died', () => {
        console.error('mediasoup worker died, exiting in 2 seconds...');
        setTimeout(() => process.exit(1), 2000);
      });

      this.workers.push(worker);
      console.log(`mediasoup worker ${i} created (PID: ${worker.pid})`);
    }

    console.log(`Initialized ${this.workers.length} mediasoup worker(s)`);
  }

  /**
   * Get or create a room router
   */
  async getOrCreateRoom(roomCode: string): Promise<Router> {
    let room = this.rooms.get(roomCode);

    if (!room) {
      // Get next worker (round-robin)
      const worker = this.workers[this.nextWorkerIndex % this.workers.length];
      this.nextWorkerIndex++;

      // Create router with Opus codec configuration
      const router = await worker.createRouter({
        mediaCodecs: [
          {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 1, // Mono
            parameters: {
              useinbandfec: 1, // Enable FEC
              usedtx: 0, // Disable DTX
              ptime: 5, // 5ms packet time
              maxptime: 10, // 10ms max packet time
            },
          },
        ],
      });

      room = {
        router,
        hostTransport: null,
        hostProducer: null,
        listenerTransports: new Map(),
        listenerConsumers: new Map(),
        createdAt: Date.now(), // Server timestamp for sync
      };

      this.rooms.set(roomCode, room);
      console.log(`Created SFU room: ${roomCode}`);
    }

    return room.router;
  }

  /**
   * Get room by code
   */
  private getRoom(roomCode: string): SFURoom | undefined {
    return this.rooms.get(roomCode);
  }

  /**
   * Create WebRTC transport for Host
   */
  async createHostTransport(roomCode: string, peerId: string): Promise<{
    transport: WebRtcTransport;
    params: {
      id: string;
      iceParameters: any;
      iceCandidates: any[];
      dtlsParameters: any;
    };
  }> {
    const room = await this.getOrCreateRoom(roomCode);
    const roomData = this.getRoom(roomCode);
    if (!roomData) {
      throw new Error('Room not found');
    }

    // Create transport with low-latency configuration
    const transport = await roomData.router.createWebRtcTransport({
      listenIps: [{ ip: this.config.listenIp, announcedIp: this.config.announcedIp }],
      enableUdp: true, // Prefer UDP
      enableTcp: true, // Fallback to TCP
      preferUdp: true,
      initialAvailableOutgoingBitrate: 64000, // 64 kbps for audio
      // Low-latency configuration
      enableSctp: false, // Disable SCTP for lower latency (we use DataChannel separately)
      enableSrtp: true, // Enable SRTP for security
      // Prioritize low latency over reliability
      maxIncomingBitrate: 64000, // Limit incoming bitrate
    });

    roomData.hostTransport = transport;

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        console.log(`Host transport closed for room ${roomCode}`);
      }
    });

    transport.on('close', () => {
      console.log(`Host transport closed for room ${roomCode}`);
      if (roomData) {
        roomData.hostTransport = null;
        roomData.hostProducer = null;
      }
    });

    return {
      transport,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    };
  }

  /**
   * Create WebRTC transport for Listener
   */
  async createListenerTransport(roomCode: string, peerId: string): Promise<{
    transport: WebRtcTransport;
    params: {
      id: string;
      iceParameters: any;
      iceCandidates: any[];
      dtlsParameters: any;
    };
  }> {
    const room = await this.getOrCreateRoom(roomCode);
    const roomData = this.getRoom(roomCode);
    if (!roomData) {
      throw new Error('Room not found');
    }

    // Create transport with low-latency configuration
    const transport = await roomData.router.createWebRtcTransport({
      listenIps: [{ ip: this.config.listenIp, announcedIp: this.config.announcedIp }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      // Low-latency configuration
      enableSctp: false, // Disable SCTP for lower latency
      enableSrtp: true, // Enable SRTP for security
    });

    roomData.listenerTransports.set(peerId, transport);

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        console.log(`Listener transport closed for room ${roomCode}, peer ${peerId}`);
      }
    });

    transport.on('close', () => {
      console.log(`Listener transport closed for room ${roomCode}, peer ${peerId}`);
      if (roomData) {
        roomData.listenerTransports.delete(peerId);
        roomData.listenerConsumers.delete(peerId);
      }
    });

    return {
      transport,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    };
  }

  /**
   * Connect transport (Host or Listener)
   */
  async connectTransport(
    roomCode: string,
    transportId: string,
    dtlsParameters: any
  ): Promise<void> {
    const roomData = this.getRoom(roomCode);
    if (!roomData) {
      throw new Error('Room not found');
    }

    let transport: Transport | undefined;

    // Find transport
    if (roomData.hostTransport?.id === transportId) {
      transport = roomData.hostTransport;
    } else {
      for (const [peerId, listenerTransport] of roomData.listenerTransports.entries()) {
        if (listenerTransport.id === transportId) {
          transport = listenerTransport;
          break;
        }
      }
    }

    if (!transport) {
      throw new Error('Transport not found');
    }

    await transport.connect({ dtlsParameters });
  }

  /**
   * Produce audio from Host
   */
  async produceAudio(
    roomCode: string,
    transportId: string,
    rtpParameters: any
  ): Promise<{ id: string; serverTimestamp: number }> {
    const roomData = this.getRoom(roomCode);
    if (!roomData || !roomData.hostTransport) {
      throw new Error('Room or host transport not found');
    }

    if (roomData.hostTransport.id !== transportId) {
      throw new Error('Transport ID mismatch');
    }

    // Create producer with low-latency configuration
    // No transcoding - pass-through Opus directly
    const producer = await roomData.hostTransport.produce({
      kind: 'audio',
      rtpParameters,
      // Low-latency settings
      paused: false, // Start immediately
      // No keyFrameRequestDelay - not applicable for audio
    });

    roomData.hostProducer = producer;

    producer.on('transportclose', () => {
      console.log(`Host producer closed for room ${roomCode}`);
      if (roomData) {
        roomData.hostProducer = null;
      }
    });

    console.log(`Host started producing audio in room ${roomCode}`);

    // Return producer ID with server timestamp for sync
    return {
      id: producer.id,
      serverTimestamp: Date.now(), // Server timestamp when producer started
    };
  }

  /**
   * Consume audio for Listener
   */
  async consumeAudio(
    roomCode: string,
    peerId: string,
    transportId: string,
    rtpCapabilities: any
  ): Promise<{
    id: string;
    producerId: string;
    kind: string;
    rtpParameters: any;
  }> {
    const roomData = this.getRoom(roomCode);
    if (!roomData) {
      throw new Error('Room not found');
    }

    if (!roomData.hostProducer) {
      throw new Error('No host producer available');
    }

    const transport = roomData.listenerTransports.get(peerId);
    if (!transport || transport.id !== transportId) {
      throw new Error('Listener transport not found');
    }

    // Check if router can consume
    if (!roomData.router.canConsume({ producerId: roomData.hostProducer.id, rtpCapabilities })) {
      throw new Error('Cannot consume producer');
    }

    // Create consumer with low-latency configuration
    // Short queue, prioritize low latency over loss concealment
    const consumer = await transport.consume({
      producerId: roomData.hostProducer.id,
      rtpCapabilities,
      paused: false, // Start immediately for low latency
      // Low-latency consumer settings
      // Note: mediasoup handles queue management internally
      // We rely on Opus pass-through and minimal buffering
    });

    roomData.listenerConsumers.set(peerId, consumer);

    consumer.on('transportclose', () => {
      console.log(`Listener consumer closed for room ${roomCode}, peer ${peerId}`);
      if (roomData) {
        roomData.listenerConsumers.delete(peerId);
      }
    });

    console.log(`Listener ${peerId} started consuming audio in room ${roomCode}`);

    // Get server timestamp for sync
    // This timestamp can be used by clients for clock synchronization
    const serverTimestamp = Date.now();

    return {
      id: consumer.id,
      producerId: roomData.hostProducer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      serverTimestamp, // Server timestamp when consumer started (for sync)
      roomCreatedAt: roomData.createdAt, // Room creation timestamp (for reference)
    };
  }

  /**
   * Remove participant from room
   */
  async removeParticipant(roomCode: string, peerId: string, role: 'host' | 'listener'): Promise<void> {
    const roomData = this.getRoom(roomCode);
    if (!roomData) {
      return;
    }

    if (role === 'host') {
      if (roomData.hostProducer) {
        roomData.hostProducer.close();
        roomData.hostProducer = null;
      }
      if (roomData.hostTransport) {
        roomData.hostTransport.close();
        roomData.hostTransport = null;
      }
    } else {
      const consumer = roomData.listenerConsumers.get(peerId);
      if (consumer) {
        consumer.close();
        roomData.listenerConsumers.delete(peerId);
      }
      const transport = roomData.listenerTransports.get(peerId);
      if (transport) {
        transport.close();
        roomData.listenerTransports.delete(peerId);
      }
    }

    // Clean up room if empty
    if (
      !roomData.hostTransport &&
      roomData.listenerTransports.size === 0
    ) {
      roomData.router.close();
      this.rooms.delete(roomCode);
      console.log(`Removed empty SFU room: ${roomCode}`);
    }
  }

  /**
   * Get router RTP capabilities
   */
  async getRtpCapabilities(roomCode: string): Promise<any> {
    const room = await this.getOrCreateRoom(roomCode);
    return room.rtpCapabilities;
  }

  /**
   * Get server timestamp for synchronization
   * Returns current server time and room creation time
   */
  getServerTimestamp(roomCode: string): { serverTime: number; roomCreatedAt?: number } | null {
    const roomData = this.getRoom(roomCode);
    if (!roomData) {
      return null;
    }

    return {
      serverTime: Date.now(),
      roomCreatedAt: roomData.createdAt,
    };
  }

  /**
   * Get producer stats with server timestamp
   * Useful for synchronization and latency monitoring
   */
  async getProducerStats(roomCode: string): Promise<{
    stats: any;
    serverTimestamp: number;
  } | null> {
    const roomData = this.getRoom(roomCode);
    if (!roomData || !roomData.hostProducer) {
      return null;
    }

    try {
      const stats = await roomData.hostProducer.getStats();
      return {
        stats,
        serverTimestamp: Date.now(),
      };
    } catch (error) {
      console.error('Error getting producer stats:', error);
      return null;
    }
  }

  /**
   * Close all rooms and workers
   */
  async close(): Promise<void> {
    // Close all rooms
    for (const [roomCode, roomData] of this.rooms.entries()) {
      if (roomData.hostProducer) {
        roomData.hostProducer.close();
      }
      if (roomData.hostTransport) {
        roomData.hostTransport.close();
      }
      for (const consumer of roomData.listenerConsumers.values()) {
        consumer.close();
      }
      for (const transport of roomData.listenerTransports.values()) {
        transport.close();
      }
      roomData.router.close();
    }
    this.rooms.clear();

    // Close all workers
    for (const worker of this.workers) {
      worker.close();
    }
    this.workers = [];

    console.log('SFU server closed');
  }
}

// Export singleton instance
export const sfuServer = new SFUServer();

