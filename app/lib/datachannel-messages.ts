/**
 * DataChannel Message Types and Utilities
 * Handles time sync, heartbeats, and host handoff control messages
 */

export type DataChannelMessageType =
  | 'time_sync_request'
  | 'time_sync_response'
  | 'heartbeat'
  | 'heartbeat_ack'
  | 'host_handoff_request'
  | 'host_handoff_response'
  | 'host_handoff_ack';

export interface BaseDataChannelMessage {
  type: DataChannelMessageType;
  timestamp: number; // Client timestamp (ms since epoch)
  messageId?: string; // Unique message ID for request/response matching
}

export interface TimeSyncRequest extends BaseDataChannelMessage {
  type: 'time_sync_request';
  clientTime: number; // Client's current time
}

export interface TimeSyncResponse extends BaseDataChannelMessage {
  type: 'time_sync_response';
  clientTime: number; // Original client time from request
  serverTime: number; // Server's time when request was received
  responseTime: number; // Server's time when response is sent
}

export interface HeartbeatMessage extends BaseDataChannelMessage {
  type: 'heartbeat';
  sequence: number; // Incremental sequence number
}

export interface HeartbeatAck extends BaseDataChannelMessage {
  type: 'heartbeat_ack';
  sequence: number; // Sequence number from heartbeat
}

export interface HostHandoffRequest extends BaseDataChannelMessage {
  type: 'host_handoff_request';
  newHostPeerId: string;
  reason?: string; // Optional reason for handoff
}

export interface HostHandoffResponse extends BaseDataChannelMessage {
  type: 'host_handoff_response';
  accepted: boolean;
  newHostPeerId?: string;
  reason?: string; // Error message if rejected
}

export interface HostHandoffAck extends BaseDataChannelMessage {
  type: 'host_handoff_ack';
  newHostPeerId: string;
}

export type DataChannelMessage =
  | TimeSyncRequest
  | TimeSyncResponse
  | HeartbeatMessage
  | HeartbeatAck
  | HostHandoffRequest
  | HostHandoffResponse
  | HostHandoffAck;

/**
 * Create time sync request message
 */
export function createTimeSyncRequest(): TimeSyncRequest {
  return {
    type: 'time_sync_request',
    timestamp: Date.now(),
    clientTime: Date.now(),
    messageId: generateMessageId(),
  };
}

/**
 * Create time sync response message
 */
export function createTimeSyncResponse(
  request: TimeSyncRequest,
  serverTime: number
): TimeSyncResponse {
  return {
    type: 'time_sync_response',
    timestamp: Date.now(),
    messageId: request.messageId,
    clientTime: request.clientTime,
    serverTime,
    responseTime: Date.now(),
  };
}

/**
 * Create heartbeat message
 */
export function createHeartbeat(sequence: number): HeartbeatMessage {
  return {
    type: 'heartbeat',
    timestamp: Date.now(),
    sequence,
  };
}

/**
 * Create heartbeat acknowledgment
 */
export function createHeartbeatAck(sequence: number): HeartbeatAck {
  return {
    type: 'heartbeat_ack',
    timestamp: Date.now(),
    sequence,
  };
}

/**
 * Create host handoff request
 */
export function createHostHandoffRequest(
  newHostPeerId: string,
  reason?: string
): HostHandoffRequest {
  return {
    type: 'host_handoff_request',
    timestamp: Date.now(),
    messageId: generateMessageId(),
    newHostPeerId,
    reason,
  };
}

/**
 * Create host handoff response
 */
export function createHostHandoffResponse(
  request: HostHandoffRequest,
  accepted: boolean,
  reason?: string
): HostHandoffResponse {
  return {
    type: 'host_handoff_response',
    timestamp: Date.now(),
    messageId: request.messageId,
    accepted,
    newHostPeerId: accepted ? request.newHostPeerId : undefined,
    reason,
  };
}

/**
 * Create host handoff acknowledgment
 */
export function createHostHandoffAck(newHostPeerId: string): HostHandoffAck {
  return {
    type: 'host_handoff_ack',
    timestamp: Date.now(),
    newHostPeerId,
  };
}

/**
 * Parse DataChannel message
 */
export function parseDataChannelMessage(data: string): DataChannelMessage | null {
  try {
    const message = JSON.parse(data);
    if (message.type && message.timestamp) {
      return message as DataChannelMessage;
    }
    return null;
  } catch (error) {
    console.error('Failed to parse DataChannel message:', error);
    return null;
  }
}

/**
 * Calculate clock offset from time sync response
 * Returns the offset in milliseconds (positive = server is ahead)
 */
export function calculateClockOffset(response: TimeSyncResponse): number {
  const roundTripTime = response.responseTime - response.clientTime;
  const oneWayDelay = roundTripTime / 2;
  const serverTimeAtRequest = response.serverTime + oneWayDelay;
  const offset = serverTimeAtRequest - response.clientTime;
  return offset;
}

/**
 * Generate unique message ID
 */
function generateMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

