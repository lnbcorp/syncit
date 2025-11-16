import { WebSocketServer, WebSocket } from 'ws';
import { Server as HTTPServer } from 'http';
import { verifyToken } from '../app/lib/jwt';
import type { TokenPayload } from '../app/lib/jwt';
import { updateParticipantRole } from '../app/lib/room-store';
import { sfuServer } from './sfu';
import { metricsAggregator, aggregateRoomMetrics } from './metrics-aggregator';

export interface WebSocketMessage {
  type: string;
  payload?: any;
  roomCode?: string;
  error?: string;
}

export interface ClientConnection {
  ws: WebSocket;
  peerId: string;
  roomCode: string | null;
  role: 'host' | 'listener' | null;
  lastHeartbeat: number;
  metrics?: {
    rtt?: number;
    jitter?: number;
    packetsLost?: number;
    jitterBufferDelay?: number;
    audioLevel?: number;
    lastUpdate: number;
  };
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  private roomClients: Map<string, Set<string>> = new Map(); // roomCode -> Set of peerIds

  /**
   * Initialize WebSocket server
   */
  initialize(server: HTTPServer) {
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
    });

    this.wss.on('connection', (ws: WebSocket, request) => {
      this.handleConnection(ws, request);
    });

    // Start heartbeat interval to detect dead connections
    setInterval(() => this.cleanupDeadConnections(), 30000); // Every 30 seconds
    
    // Start automatic heartbeat requests (5s interval)
    setInterval(() => this.sendHeartbeatToAll(), 5000); // Every 5 seconds
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, request: any) {
    const peerId = this.generatePeerId();
    const connection: ClientConnection = {
      ws,
      peerId,
      roomCode: null,
      role: null,
      lastHeartbeat: Date.now(),
    };

    // Store connection immediately (will be updated on authenticate)
    this.clients.set(peerId, connection);

    ws.on('message', async (data: Buffer) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        await this.handleMessage(ws, message, connection);
      } catch (error) {
        console.error('Error handling message:', error);
        this.sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      if (connection) {
        this.handleDisconnection(connection);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      if (connection) {
        this.handleDisconnection(connection);
      }
    });

    // Send welcome message
    this.send(ws, {
      type: 'connected',
      payload: { peerId },
    });
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    switch (message.type) {
      case 'authenticate':
        await this.handleAuthenticate(ws, message, connection);
        break;
      case 'create_room':
        await this.handleCreateRoom(ws, message, connection);
        break;
      case 'join_room':
        await this.handleJoinRoom(ws, message, connection);
        break;
      case 'sdp_offer':
        await this.handleSDPOffer(ws, message, connection);
        break;
      case 'sdp_answer':
        await this.handleSDPAnswer(ws, message, connection);
        break;
      case 'ice_candidate':
        await this.handleICECandidate(ws, message, connection);
        break;
      case 'host_handoff':
        await this.handleHostHandoff(ws, message, connection);
        break;
      case 'leave':
        await this.handleLeave(ws, message, connection);
        // Remove from SFU on leave
        if (connection && connection.roomCode && connection.role) {
          sfuServer.removeParticipant(connection.roomCode, connection.peerId, connection.role).catch((error) => {
            console.error('Error removing participant from SFU on leave:', error);
          });
        }
        break;
      case 'heartbeat':
        this.handleHeartbeat(ws, connection);
        break;
      case 'metrics':
        this.handleMetrics(ws, message, connection);
        break;
      case 'get_router_rtp_capabilities':
        await this.handleGetRouterRtpCapabilities(ws, message, connection);
        break;
      case 'create_transport':
        await this.handleCreateTransport(ws, message, connection);
        break;
      case 'connect_transport':
        await this.handleConnectTransport(ws, message, connection);
        break;
      case 'produce':
        await this.handleProduce(ws, message, connection);
        break;
      case 'consume':
        await this.handleConsume(ws, message, connection);
        break;
      case 'transport_ice_candidate':
        await this.handleTransportIceCandidate(ws, message, connection);
        break;
      case 'time_sync_request':
        await this.handleTimeSyncRequest(ws, message, connection);
        break;
      case 'tone_mark':
        await this.handleToneMark(ws, message, connection);
        break;
      default:
        this.sendError(ws, `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle authentication
   */
  private async handleAuthenticate(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    try {
      const { token } = message.payload || {};
      if (!token) {
        this.sendError(ws, 'Token required');
        return;
      }

      const payload = verifyToken(token);
      const peerId = payload.peerId;

      // Get or create connection
      let conn = connection;
      if (!conn || conn.peerId !== peerId) {
        // Find existing connection by peerId or create new one
        conn = this.clients.get(peerId);
        if (!conn) {
          conn = {
            ws,
            peerId,
            roomCode: payload.roomCode,
            role: payload.role,
            lastHeartbeat: Date.now(),
          };
          this.clients.set(peerId, conn);
        } else {
          // Update existing connection
          conn.ws = ws; // Update WebSocket reference
          conn.roomCode = payload.roomCode;
          conn.role = payload.role;
          conn.lastHeartbeat = Date.now();
        }
      } else {
        // Update existing connection
        conn.roomCode = payload.roomCode;
        conn.role = payload.role;
        conn.lastHeartbeat = Date.now();
      }

      // Add to room
      if (payload.roomCode) {
        this.addToRoom(payload.roomCode, peerId);
        // Send presence update to Host if joining existing room
        this.sendPresenceUpdateToHost(payload.roomCode);
      }

      this.send(ws, {
        type: 'authenticated',
        payload: { peerId, role: payload.role, roomCode: payload.roomCode },
      });
    } catch (error) {
      // Handle different token errors
      const errorMessage = error instanceof Error ? error.message : 'Invalid token';
      if (errorMessage.includes('expired')) {
        this.sendError(ws, 'Token has expired. Please rejoin the room.');
      } else {
        this.sendError(ws, 'Invalid token. Please rejoin the room.');
      }
    }
  }

  /**
   * Handle room join
   */
  private async handleJoinRoom(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    const { roomCode } = message.payload || {};
    if (!roomCode) {
      this.sendError(ws, 'Room code required');
      return;
    }

    // Update connection
    connection.roomCode = roomCode;
    this.addToRoom(roomCode, connection.peerId);

    // Record join event for metrics
    metricsAggregator.recordJoin(roomCode);

    // Notify other clients in room
    this.broadcastToRoom(
      roomCode,
      {
        type: 'peer_joined',
        payload: {
          peerId: connection.peerId,
          role: connection.role,
          roomCode,
        },
      },
      connection.peerId
    );

    // Send presence update to Host
    this.sendPresenceUpdateToHost(roomCode);

    this.send(ws, {
      type: 'room_joined',
      payload: { roomCode },
    });
  }

  /**
   * Handle create room (similar to join_room but for room creation)
   */
  private async handleCreateRoom(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    // Create room is essentially the same as join_room
    // The room is created via API, this just handles the WebSocket connection
    await this.handleJoinRoom(ws, message, connection);
  }

  /**
   * Handle SDP offer (from Host to SFU/Listeners)
   */
  private async handleSDPOffer(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode) {
      this.sendError(ws, 'Not authenticated or not in a room');
      return;
    }

    const { sdp, targetPeerId } = message.payload || {};
    if (!sdp) {
      this.sendError(ws, 'SDP offer required');
      return;
    }

    // If targetPeerId is specified, send to specific peer (for SFU)
    // Otherwise, broadcast to all listeners in room
    if (targetPeerId) {
      this.sendToClient(targetPeerId, {
        type: 'sdp_offer',
        payload: {
          sdp,
          fromPeerId: connection.peerId,
          roomCode: connection.roomCode,
        },
      });
    } else {
      // Broadcast to all listeners (excluding sender)
      this.broadcastToRoom(
        connection.roomCode,
        {
          type: 'sdp_offer',
          payload: {
            sdp,
            fromPeerId: connection.peerId,
            roomCode: connection.roomCode,
          },
        },
        connection.peerId
      );
    }
  }

  /**
   * Handle SDP answer (from Listener/SFU to Host)
   */
  private async handleSDPAnswer(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode) {
      this.sendError(ws, 'Not authenticated or not in a room');
      return;
    }

    const { sdp, targetPeerId } = message.payload || {};
    if (!sdp || !targetPeerId) {
      this.sendError(ws, 'SDP answer and target peer ID required');
      return;
    }

    // Send SDP answer to target peer (usually Host)
    this.sendToClient(targetPeerId, {
      type: 'sdp_answer',
      payload: {
        sdp,
        fromPeerId: connection.peerId,
        roomCode: connection.roomCode,
      },
    });
  }

  /**
   * Handle ICE candidate forwarding
   */
  private async handleICECandidate(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode) {
      this.sendError(ws, 'Not authenticated or not in a room');
      return;
    }

    const { candidate, targetPeerId } = message.payload || {};
    if (!candidate) {
      this.sendError(ws, 'ICE candidate required');
      return;
    }

    // If targetPeerId is specified, send to specific peer
    // Otherwise, broadcast to all in room (excluding sender)
    if (targetPeerId) {
      this.sendToClient(targetPeerId, {
        type: 'ice_candidate',
        payload: {
          candidate,
          fromPeerId: connection.peerId,
          roomCode: connection.roomCode,
        },
      });
    } else {
      this.broadcastToRoom(
        connection.roomCode,
        {
          type: 'ice_candidate',
          payload: {
            candidate,
            fromPeerId: connection.peerId,
            roomCode: connection.roomCode,
          },
        },
        connection.peerId
      );
    }
  }

  /**
   * Handle host handoff
   */
  private async handleHostHandoff(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode) {
      this.sendError(ws, 'Not authenticated or not in a room');
      return;
    }

    if (connection.role !== 'host') {
      this.sendError(ws, 'Only host can initiate handoff');
      return;
    }

    const { newHostPeerId } = message.payload || {};
    if (!newHostPeerId) {
      this.sendError(ws, 'New host peer ID required');
      return;
    }

    const newHostConnection = this.clients.get(newHostPeerId);
    if (!newHostConnection || newHostConnection.roomCode !== connection.roomCode) {
      this.sendError(ws, 'New host not found in room');
      return;
    }

    // Update roles in WebSocket connections
    connection.role = 'listener';
    newHostConnection.role = 'host';

    // Update roles in room store
    if (connection.roomCode) {
      updateParticipantRole(connection.roomCode, connection.peerId, 'listener');
      updateParticipantRole(connection.roomCode, newHostPeerId, 'host');
    }

    // Notify all clients in room about the handoff
    this.broadcastToRoom(
      connection.roomCode,
      {
        type: 'host_handoff',
        payload: {
          oldHostPeerId: connection.peerId,
          newHostPeerId: newHostPeerId,
          roomCode: connection.roomCode,
          timestamp: Date.now(),
        },
      }
    );

    // Send presence update to new host
    if (connection.roomCode) {
      this.sendPresenceUpdateToHost(connection.roomCode);
    }
  }

  /**
   * Handle leave room
   */
  private async handleLeave(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode) {
      this.sendError(ws, 'Not in a room');
      return;
    }

    const roomCode = connection.roomCode;
    const wasHost = connection.role === 'host';

    // Record leave event for metrics
    metricsAggregator.recordLeave(roomCode);

    // Remove from room
    this.removeFromRoom(roomCode, connection.peerId);

    // Notify other clients
    this.broadcastToRoom(
      roomCode,
      {
        type: 'peer_left',
        payload: {
          peerId: connection.peerId,
          role: connection.role,
          roomCode,
        },
      }
    );

    // If host left, handle auto-promotion
    if (wasHost) {
      this.handleHostDisconnection(roomCode);
    } else {
      // Send presence update to Host
      this.sendPresenceUpdateToHost(roomCode);
    }

    // Clear room from connection
    connection.roomCode = null;
    connection.role = null;

    this.send(ws, {
      type: 'left_room',
      payload: { roomCode },
    });
  }

  /**
   * Handle heartbeat
   */
  private handleHeartbeat(ws: WebSocket, connection: ClientConnection | null) {
    if (connection) {
      connection.lastHeartbeat = Date.now();
      this.send(ws, { type: 'heartbeat_ack' });
    }
  }

  /**
   * Handle metrics collection
   */
  private handleMetrics(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection) {
      return;
    }

    const metrics = message.payload || {};
    connection.metrics = {
      rtt: metrics.rtt,
      jitter: metrics.jitter,
      packetsLost: metrics.packetsLost,
      jitterBufferDelay: metrics.jitterBufferDelay,
      jitterBufferEmittedCount: metrics.jitterBufferEmittedCount,
      audioLevel: metrics.audioLevel,
      lastUpdate: Date.now(),
    };

    // Metrics are now available for room-level aggregation
    // Trigger aggregation for the room
    if (connection.roomCode) {
      this.aggregateRoomMetrics(connection.roomCode);
    }

    // Acknowledge
    this.send(ws, {
      type: 'metrics_received',
      payload: { timestamp: Date.now() },
    });
  }

  /**
   * Aggregate room metrics and send to host
   */
  private aggregateRoomMetrics(roomCode: string): void {
    const connections = this.getRoomClients(roomCode);
    const events = metricsAggregator.getEvents(roomCode);
    const metrics = aggregateRoomMetrics(roomCode, connections, events);

    // Send to host
    const roomClients = this.getRoomClients(roomCode);
    const host = roomClients.find(conn => conn.role === 'host');

    if (host) {
      this.sendToClient(host.peerId, {
        type: 'room_metrics',
        payload: metrics,
      });
    }
  }

  /**
   * Send heartbeat to all connected clients
   */
  private sendHeartbeatToAll() {
    for (const connection of this.clients.values()) {
      if (connection.ws.readyState === WebSocket.OPEN) {
        this.send(connection.ws, { type: 'heartbeat' });
      }
    }
  }

  /**
   * Add client to room
   */
  private addToRoom(roomCode: string, peerId: string) {
    if (!this.roomClients.has(roomCode)) {
      this.roomClients.set(roomCode, new Set());
    }
    this.roomClients.get(roomCode)!.add(peerId);
  }

  /**
   * Remove client from room
   */
  private removeFromRoom(roomCode: string, peerId: string) {
    const roomSet = this.roomClients.get(roomCode);
    if (roomSet) {
      roomSet.delete(peerId);
      if (roomSet.size === 0) {
        this.roomClients.delete(roomCode);
      }
    }
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(connection: ClientConnection) {
    if (connection.roomCode && connection.role) {
      const roomCode = connection.roomCode;
      const wasHost = connection.role === 'host';

      // Record leave event for metrics
      metricsAggregator.recordLeave(roomCode);

      // Remove from SFU
      sfuServer.removeParticipant(roomCode, connection.peerId, connection.role).catch((error) => {
        console.error('Error removing participant from SFU:', error);
      });

      // Remove from room
      this.removeFromRoom(roomCode, connection.peerId);

      // Notify other clients
      this.broadcastToRoom(
        roomCode,
        {
          type: 'peer_left',
          payload: {
            peerId: connection.peerId,
            role: connection.role,
            roomCode,
          },
        }
      );

      // If host disconnected, try to auto-promote a listener
      if (wasHost) {
        this.handleHostDisconnection(roomCode);
      } else {
        // Send presence update to Host
        this.sendPresenceUpdateToHost(roomCode);
      }
    }
    this.clients.delete(connection.peerId);
  }

  /**
   * Handle host disconnection - auto-promote listener to host
   */
  private handleHostDisconnection(roomCode: string) {
    const roomClients = this.getRoomClients(roomCode);
    
    // Find first listener to promote
    const listener = roomClients.find(conn => conn.role === 'listener');
    
    if (listener) {
      // Promote listener to host in WebSocket connection
      listener.role = 'host';
      
      // Update role in room store
      updateParticipantRole(roomCode, listener.peerId, 'host');
      
      // Notify all clients about the promotion
      this.broadcastToRoom(
        roomCode,
        {
          type: 'host_promoted',
          payload: {
            newHostPeerId: listener.peerId,
            roomCode,
            reason: 'host_disconnected',
            timestamp: Date.now(),
          },
        }
      );

      // Send presence update to new host
      this.sendPresenceUpdateToHost(roomCode);
    } else {
      // No listeners available, notify that host left
      this.broadcastToRoom(
        roomCode,
        {
          type: 'host_left',
          payload: {
            roomCode,
            message: 'Host disconnected and no listeners available',
          },
        }
      );
    }
  }

  /**
   * Send presence update to Host
   */
  private sendPresenceUpdateToHost(roomCode: string) {
    const roomClients = this.getRoomClients(roomCode);
    const host = roomClients.find(conn => conn.role === 'host');
    
    if (!host) return;

    const participants = roomClients.map(conn => ({
      peerId: conn.peerId,
      role: conn.role,
      lastHeartbeat: conn.lastHeartbeat,
      metrics: conn.metrics,
    }));

    this.sendToClient(host.peerId, {
      type: 'presence_update',
      payload: {
        roomCode,
        participants,
        totalCount: participants.length,
        listenerCount: participants.filter(p => p.role === 'listener').length,
        timestamp: Date.now(),
      },
    });
  }

  /**
   * Handle get router RTP capabilities
   */
  private async handleGetRouterRtpCapabilities(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode) {
      this.sendError(ws, 'Not authenticated or not in a room');
      return;
    }

    try {
      const rtpCapabilities = await sfuServer.getRtpCapabilities(connection.roomCode);
      this.send(ws, {
        type: 'router_rtp_capabilities',
        payload: { rtpCapabilities },
      });
    } catch (error) {
      console.error('Error getting router RTP capabilities:', error);
      this.sendError(ws, 'Failed to get router RTP capabilities');
    }
  }

  /**
   * Handle create transport
   */
  private async handleCreateTransport(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode || !connection.role) {
      this.sendError(ws, 'Not authenticated or not in a room');
      return;
    }

    try {
      let result;
      if (connection.role === 'host') {
        result = await sfuServer.createHostTransport(connection.roomCode, connection.peerId);
      } else {
        result = await sfuServer.createListenerTransport(connection.roomCode, connection.peerId);
      }

      this.send(ws, {
        type: 'transport_created',
        payload: {
          transportId: result.params.id,
          iceParameters: result.params.iceParameters,
          iceCandidates: result.params.iceCandidates,
          dtlsParameters: result.params.dtlsParameters,
        },
      });
    } catch (error) {
      console.error('Error creating transport:', error);
      this.sendError(ws, 'Failed to create transport');
    }
  }

  /**
   * Handle connect transport
   */
  private async handleConnectTransport(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode) {
      this.sendError(ws, 'Not authenticated or not in a room');
      return;
    }

    const { transportId, dtlsParameters } = message.payload || {};
    if (!transportId || !dtlsParameters) {
      this.sendError(ws, 'Transport ID and DTLS parameters required');
      return;
    }

    try {
      await sfuServer.connectTransport(connection.roomCode, transportId, dtlsParameters);
      this.send(ws, {
        type: 'transport_connected',
        payload: { transportId },
      });
    } catch (error) {
      console.error('Error connecting transport:', error);
      this.sendError(ws, 'Failed to connect transport');
    }
  }

  /**
   * Handle produce (Host only)
   */
  private async handleProduce(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode || connection.role !== 'host') {
      this.sendError(ws, 'Only host can produce');
      return;
    }

    const { transportId, rtpParameters } = message.payload || {};
    if (!transportId || !rtpParameters) {
      this.sendError(ws, 'Transport ID and RTP parameters required');
      return;
    }

    try {
      const result = await sfuServer.produceAudio(connection.roomCode, transportId, rtpParameters);
      this.send(ws, {
        type: 'produced',
        payload: {
          producerId: result.id,
          serverTimestamp: result.serverTimestamp, // Server timestamp for sync
        },
      });
    } catch (error) {
      console.error('Error producing audio:', error);
      this.sendError(ws, 'Failed to produce audio');
    }
  }

  /**
   * Handle consume (Listener only)
   */
  private async handleConsume(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode || connection.role !== 'listener') {
      this.sendError(ws, 'Only listener can consume');
      return;
    }

    const { transportId, rtpCapabilities } = message.payload || {};
    if (!transportId || !rtpCapabilities) {
      this.sendError(ws, 'Transport ID and RTP capabilities required');
      return;
    }

    try {
      const result = await sfuServer.consumeAudio(
        connection.roomCode,
        connection.peerId,
        transportId,
        rtpCapabilities
      );
      this.send(ws, {
        type: 'consumed',
        payload: {
          consumerId: result.id,
          producerId: result.producerId,
          kind: result.kind,
          rtpParameters: result.rtpParameters,
          serverTimestamp: result.serverTimestamp, // Server timestamp for sync
          roomCreatedAt: result.roomCreatedAt, // Room creation timestamp
        },
      });
    } catch (error) {
      console.error('Error consuming audio:', error);
      this.sendError(ws, 'Failed to consume audio');
    }
  }

  /**
   * Handle transport ICE candidate
   */
  private async handleTransportIceCandidate(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    // ICE candidates are handled by mediasoup internally
    // This is just for logging/debugging
    const { transportId, candidate } = message.payload || {};
    if (transportId && candidate) {
      console.log(`ICE candidate for transport ${transportId}:`, candidate);
    }
  }

  /**
   * Handle time sync request
   * Responds with server timestamp for clock synchronization
   */
  private async handleTimeSyncRequest(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    const { clientTime, messageId } = message.payload || {};
    const serverTime = Date.now(); // Server time when request was received
    
    // Send response immediately
    this.send(ws, {
      type: 'time_sync_response',
      payload: {
        messageId,
        clientTime,
        serverTime,
        responseTime: Date.now(), // Server time when response is sent
      },
    });
  }

  /**
   * Handle tone mark from listener
   * Forwards to host for skew monitoring
   */
  private async handleToneMark(
    ws: WebSocket,
    message: WebSocketMessage,
    connection: ClientConnection | null
  ) {
    if (!connection || !connection.roomCode || connection.role !== 'listener') {
      this.sendError(ws, 'Only listeners can send tone marks');
      return;
    }

    const { timestamp, sequence } = message.payload || {};
    if (timestamp === undefined) {
      this.sendError(ws, 'Timestamp required');
      return;
    }

    // Forward tone mark to host for skew monitoring
    const roomClients = this.getRoomClients(connection.roomCode);
    const host = roomClients.find(conn => conn.role === 'host');

    if (host) {
      this.sendToClient(host.peerId, {
        type: 'tone_mark',
        payload: {
          listenerPeerId: connection.peerId,
          timestamp,
          sequence: sequence || 0,
          serverTimestamp: Date.now(),
        },
      });
    }
  }

  /**
   * Clean up dead connections (heartbeat timeout handling)
   */
  private cleanupDeadConnections() {
    const now = Date.now();
    const timeout = 60000; // 60 seconds (heartbeat is every 5s, so 12 missed = dead)

    const deadConnections: ClientConnection[] = [];

    for (const [peerId, connection] of this.clients.entries()) {
      if (now - connection.lastHeartbeat > timeout) {
        console.log(`Cleaning up dead connection: ${peerId} (last heartbeat: ${now - connection.lastHeartbeat}ms ago)`);
        deadConnections.push(connection);
      }
    }

    // Terminate and handle disconnection for dead connections
    for (const connection of deadConnections) {
      try {
        connection.ws.terminate();
      } catch (error) {
        console.error('Error terminating dead connection:', error);
      }
      this.handleDisconnection(connection);
    }
  }

  /**
   * Broadcast message to all clients in a room
   */
  broadcastToRoom(roomCode: string, message: WebSocketMessage, excludePeerId?: string) {
    const roomSet = this.roomClients.get(roomCode);
    if (!roomSet) return;

    for (const peerId of roomSet) {
      if (peerId === excludePeerId) continue;
      const connection = this.clients.get(peerId);
      if (connection && connection.ws.readyState === WebSocket.OPEN) {
        this.send(connection.ws, message);
      }
    }
  }

  /**
   * Send message to specific client
   */
  sendToClient(peerId: string, message: WebSocketMessage) {
    const connection = this.clients.get(peerId);
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      this.send(connection.ws, message);
    }
  }

  /**
   * Send message helper
   */
  private send(ws: WebSocket, message: WebSocketMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error helper
   */
  private sendError(ws: WebSocket, error: string) {
    this.send(ws, {
      type: 'error',
      error,
    });
  }

  /**
   * Generate unique peer ID
   */
  private generatePeerId(): string {
    return `peer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get connection by peer ID
   */
  getConnection(peerId: string): ClientConnection | undefined {
    return this.clients.get(peerId);
  }

  /**
   * Get all clients in a room
   */
  getRoomClients(roomCode: string): ClientConnection[] {
    const roomSet = this.roomClients.get(roomCode);
    if (!roomSet) return [];

    return Array.from(roomSet)
      .map(peerId => this.clients.get(peerId))
      .filter((conn): conn is ClientConnection => conn !== undefined);
  }
}

// Export singleton instance
export const wsManager = new WebSocketManager();

