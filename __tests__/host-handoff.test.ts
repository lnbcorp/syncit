/**
 * Tests for host handoff functionality
 */

import {
  createRoom,
  setHost,
  addListener,
  updateParticipantRole,
  getRoomParticipants,
  getRoom,
} from '@/app/lib/room-store';

describe('Host Handoff', () => {
  it('should transfer host role from one participant to another', () => {
    const room = createRoom();
    const oldHostId = 'host-1';
    const newHostId = 'listener-1';

    // Set initial host
    setHost(room.code, oldHostId);
    
    // Add listener
    addListener(room.code, newHostId);

    // Perform handoff
    const success = updateParticipantRole(room.code, newHostId, 'host');
    expect(success).toBe(true);

    // Verify new host
    const roomData = getRoom(room.code);
    expect(roomData?.hostPeerId).toBe(newHostId);

    // Verify old host is now listener
    const participants = getRoomParticipants(room.code);
    const oldHost = participants.find(p => p.peerId === oldHostId);
    expect(oldHost?.role).toBe('listener');

    // Verify new host role
    const newHost = participants.find(p => p.peerId === newHostId);
    expect(newHost?.role).toBe('host');
  });

  it('should handle handoff with multiple listeners', () => {
    const room = createRoom();
    const oldHostId = 'host-1';
    const listener1Id = 'listener-1';
    const listener2Id = 'listener-2';
    const newHostId = 'listener-3';

    // Set up room with host and multiple listeners
    setHost(room.code, oldHostId);
    addListener(room.code, listener1Id);
    addListener(room.code, listener2Id);
    addListener(room.code, newHostId);

    // Perform handoff
    updateParticipantRole(room.code, newHostId, 'host');

    // Verify all participants still exist
    const participants = getRoomParticipants(room.code);
    expect(participants.length).toBe(4);

    // Verify roles
    expect(participants.find(p => p.peerId === oldHostId)?.role).toBe('listener');
    expect(participants.find(p => p.peerId === newHostId)?.role).toBe('host');
    expect(participants.find(p => p.peerId === listener1Id)?.role).toBe('listener');
    expect(participants.find(p => p.peerId === listener2Id)?.role).toBe('listener');
  });

  it('should fail handoff if new host not in room', () => {
    const room = createRoom();
    setHost(room.code, 'host-1');

    // Try to handoff to non-existent participant
    const success = updateParticipantRole(room.code, 'non-existent', 'host');
    expect(success).toBe(false);

    // Original host should still be host
    const roomData = getRoom(room.code);
    expect(roomData?.hostPeerId).toBe('host-1');
  });

  it('should handle multiple handoffs', () => {
    const room = createRoom();
    const host1Id = 'host-1';
    const host2Id = 'host-2';
    const host3Id = 'host-3';

    setHost(room.code, host1Id);
    addListener(room.code, host2Id);
    addListener(room.code, host3Id);

    // First handoff
    updateParticipantRole(room.code, host2Id, 'host');
    let roomData = getRoom(room.code);
    expect(roomData?.hostPeerId).toBe(host2Id);

    // Second handoff
    updateParticipantRole(room.code, host3Id, 'host');
    roomData = getRoom(room.code);
    expect(roomData?.hostPeerId).toBe(host3Id);

    // Verify all previous hosts are now listeners
    const participants = getRoomParticipants(room.code);
    expect(participants.find(p => p.peerId === host1Id)?.role).toBe('listener');
    expect(participants.find(p => p.peerId === host2Id)?.role).toBe('listener');
    expect(participants.find(p => p.peerId === host3Id)?.role).toBe('host');
  });
});

