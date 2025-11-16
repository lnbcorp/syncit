import { generateRoomCode } from './room-code';

/**
 * In-memory room store
 * In production, this should use Redis with TTL
 * This implementation provides a Redis-compatible interface
 */

export interface Participant {
  peerId: string;
  role: 'host' | 'listener';
  joinedAt: number;
  deviceHints?: {
    userAgent?: string;
    platform?: string;
    audioDevices?: string[];
  };
}

export interface Room {
  code: string;
  createdAt: number;
  region: string;
  capacity: number;
  hostPeerId: string | null;
  listeners: string[];
  participants: Map<string, Participant>; // peerId -> Participant
  status: 'active' | 'ended';
  expiresAt: number;
}

const rooms = new Map<string, Room>();
const recycledCodes = new Set<string>(); // Track recently recycled codes to prevent immediate reuse

const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CODE_RECYCLE_DELAY_MS = 5 * 60 * 1000; // 5 minutes before code can be reused

/**
 * Check if code is available (not in use and not recently recycled)
 */
function isCodeAvailable(code: string): boolean {
  if (rooms.has(code)) {
    const room = getRoom(code);
    if (room) return false; // Room exists and is active
  }
  return !recycledCodes.has(code); // Not recently recycled
}

/**
 * Create a new room
 * Retries if code collision occurs (unlikely but possible)
 */
export function createRoom(region: string = 'us-east'): Room {
  let code: string;
  let attempts = 0;
  const maxAttempts = 10;

  // Ensure unique code (not in use and not recently recycled)
  do {
    code = generateRoomCode();
    attempts++;
    
    if (attempts > maxAttempts) {
      throw new Error('Failed to generate unique room code after multiple attempts');
    }
  } while ((rooms.has(code) && getRoom(code) !== undefined) || recycledCodes.has(code));

  const now = Date.now();

  const room: Room = {
    code,
    createdAt: now,
    region,
    capacity: 27,
    hostPeerId: null,
    listeners: [],
    participants: new Map(),
    status: 'active',
    expiresAt: now + ROOM_TTL_MS,
  };

  rooms.set(code, room);
  return room;
}

/**
 * Get room by code
 */
export function getRoom(code: string): Room | undefined {
  const room = rooms.get(code);
  
  // Check if room has expired
  if (room && Date.now() > room.expiresAt) {
    rooms.delete(code);
    return undefined;
  }
  
  return room;
}

/**
 * Check if room exists and is active
 */
export function isRoomActive(code: string): boolean {
  const room = getRoom(code);
  return room !== undefined && room.status === 'active';
}

/**
 * Check if room has capacity
 */
export function hasCapacity(code: string): boolean {
  const room = getRoom(code);
  if (!room) return false;
  
  const currentParticipants = (room.hostPeerId ? 1 : 0) + room.listeners.length;
  return currentParticipants < room.capacity;
}

/**
 * Add host to room
 */
export function setHost(code: string, peerId: string, deviceHints?: Participant['deviceHints']): void {
  const room = getRoom(code);
  if (room) {
    room.hostPeerId = peerId;
    
    // Add or update participant
    const participant: Participant = {
      peerId,
      role: 'host',
      joinedAt: Date.now(),
      deviceHints,
    };
    room.participants.set(peerId, participant);
  }
}

/**
 * Add listener to room
 */
export function addListener(code: string, peerId: string, deviceHints?: Participant['deviceHints']): void {
  const room = getRoom(code);
  if (room && !room.listeners.includes(peerId)) {
    room.listeners.push(peerId);
    
    // Add or update participant
    const participant: Participant = {
      peerId,
      role: 'listener',
      joinedAt: Date.now(),
      deviceHints,
    };
    room.participants.set(peerId, participant);
  }
}

/**
 * Remove participant from room
 */
export function removeParticipant(code: string, peerId: string): void {
  const room = getRoom(code);
  if (!room) return;
  
  if (room.hostPeerId === peerId) {
    room.hostPeerId = null;
  } else {
    room.listeners = room.listeners.filter(id => id !== peerId);
  }
  
  // Remove from participants map
  room.participants.delete(peerId);
}

/**
 * Get participant by peer ID
 */
export function getParticipant(code: string, peerId: string): Participant | undefined {
  const room = getRoom(code);
  return room?.participants.get(peerId);
}

/**
 * Get all participants in a room
 */
export function getRoomParticipants(code: string): Participant[] {
  const room = getRoom(code);
  if (!room) return [];
  return Array.from(room.participants.values());
}

/**
 * Update participant role (for host handoff)
 */
export function updateParticipantRole(code: string, peerId: string, newRole: 'host' | 'listener'): boolean {
  const room = getRoom(code);
  if (!room) return false;
  
  const participant = room.participants.get(peerId);
  if (!participant) return false;
  
  // Update role
  participant.role = newRole;
  
  // Update room's hostPeerId and listeners array
  if (newRole === 'host') {
    // Remove old host if exists
    if (room.hostPeerId && room.hostPeerId !== peerId) {
      const oldHost = room.participants.get(room.hostPeerId);
      if (oldHost) {
        oldHost.role = 'listener';
        if (!room.listeners.includes(room.hostPeerId)) {
          room.listeners.push(room.hostPeerId);
        }
      }
    }
    // Set new host
    room.hostPeerId = peerId;
    // Remove from listeners if present
    room.listeners = room.listeners.filter(id => id !== peerId);
  } else {
    // Demote to listener
    if (room.hostPeerId === peerId) {
      room.hostPeerId = null;
    }
    if (!room.listeners.includes(peerId)) {
      room.listeners.push(peerId);
    }
  }
  
  return true;
}

/**
 * End room
 */
export function endRoom(code: string): void {
  const room = getRoom(code);
  if (room) {
    room.status = 'ended';
    rooms.delete(code);
  }
}

/**
 * Clean up expired rooms and recycle codes
 */
export function cleanupExpiredRooms(): void {
  const now = Date.now();
  const codesToRecycle: string[] = [];
  
  for (const [code, room] of rooms.entries()) {
    if (now > room.expiresAt || room.status === 'ended') {
      rooms.delete(code);
      codesToRecycle.push(code);
    }
  }
  
  // Mark codes for recycling (prevent immediate reuse)
  for (const code of codesToRecycle) {
    recycledCodes.add(code);
    // Remove from recycled set after delay
    setTimeout(() => {
      recycledCodes.delete(code);
    }, CODE_RECYCLE_DELAY_MS);
  }
}


// Clean up every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredRooms, 10 * 60 * 1000);
}

