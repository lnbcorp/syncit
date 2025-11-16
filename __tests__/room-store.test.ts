/**
 * Tests for room store functionality
 * Tests capacity cap at 27, host assignment, and room management
 */

import {
  createRoom,
  getRoom,
  isRoomActive,
  hasCapacity,
  setHost,
  addListener,
  removeParticipant,
  getRoomParticipants,
  updateParticipantRole,
} from '@/app/lib/room-store';

describe('Room Store', () => {
  beforeEach(() => {
    // Clear rooms before each test
    // Note: In a real implementation, we'd need a way to clear the store
    // For now, we'll work with the assumption that tests run in isolation
  });

  describe('Room Creation', () => {
    it('should create a room with valid code', () => {
      const room = createRoom();
      expect(room).toBeDefined();
      expect(room.code).toMatch(/^\d{6}$/);
      expect(room.capacity).toBe(27);
      expect(room.status).toBe('active');
      expect(room.hostPeerId).toBeNull();
      expect(room.listeners).toEqual([]);
    });

    it('should create rooms with unique codes', () => {
      const room1 = createRoom();
      const room2 = createRoom();
      expect(room1.code).not.toBe(room2.code);
    });
  });

  describe('Room Capacity', () => {
    it('should allow joining when under capacity', () => {
      const room = createRoom();
      expect(hasCapacity(room.code)).toBe(true);
    });

    it('should enforce capacity limit of 27', () => {
      const room = createRoom();
      
      // Add host (1 participant)
      const hostPeerId = 'host-1';
      setHost(room.code, hostPeerId);
      
      // Add 26 listeners (total 27)
      for (let i = 1; i <= 26; i++) {
        addListener(room.code, `listener-${i}`);
      }
      
      // Room should be at capacity
      expect(hasCapacity(room.code)).toBe(false);
      
      // Verify participant count
      const participants = getRoomParticipants(room.code);
      expect(participants.length).toBe(27);
    });

    it('should reject joining when at capacity', () => {
      const room = createRoom();
      
      // Fill room to capacity
      setHost(room.code, 'host-1');
      for (let i = 1; i <= 26; i++) {
        addListener(room.code, `listener-${i}`);
      }
      
      // Try to add one more (should fail)
      expect(hasCapacity(room.code)).toBe(false);
    });
  });

  describe('Host Assignment', () => {
    it('should assign first participant as host', () => {
      const room = createRoom();
      const peerId = 'peer-1';
      
      setHost(room.code, peerId);
      
      const roomData = getRoom(room.code);
      expect(roomData?.hostPeerId).toBe(peerId);
      
      const participant = roomData?.participants.get(peerId);
      expect(participant?.role).toBe('host');
    });

    it('should allow host handoff', () => {
      const room = createRoom();
      
      // Set initial host
      const oldHostId = 'host-1';
      setHost(room.code, oldHostId);
      
      // Add listener
      const newHostId = 'listener-1';
      addListener(room.code, newHostId);
      
      // Perform host handoff
      const success = updateParticipantRole(room.code, newHostId, 'host');
      expect(success).toBe(true);
      
      const roomData = getRoom(room.code);
      expect(roomData?.hostPeerId).toBe(newHostId);
      
      // Old host should be demoted to listener
      const oldHost = roomData?.participants.get(oldHostId);
      expect(oldHost?.role).toBe('listener');
    });
  });

  describe('Participant Management', () => {
    it('should add and remove participants', () => {
      const room = createRoom();
      const peerId = 'peer-1';
      
      setHost(room.code, peerId);
      expect(getRoomParticipants(room.code).length).toBe(1);
      
      removeParticipant(room.code, peerId);
      expect(getRoomParticipants(room.code).length).toBe(0);
    });

    it('should track listener count correctly', () => {
      const room = createRoom();
      
      setHost(room.code, 'host-1');
      addListener(room.code, 'listener-1');
      addListener(room.code, 'listener-2');
      
      const participants = getRoomParticipants(room.code);
      const listeners = participants.filter(p => p.role === 'listener');
      expect(listeners.length).toBe(2);
    });
  });

  describe('Room Status', () => {
    it('should identify active rooms', () => {
      const room = createRoom();
      expect(isRoomActive(room.code)).toBe(true);
    });

    it('should return undefined for non-existent rooms', () => {
      expect(getRoom('999999')).toBeUndefined();
      expect(isRoomActive('999999')).toBe(false);
    });
  });
});

