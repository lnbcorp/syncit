/**
 * Tests for room API endpoints
 * Tests room creation, joining, and error states
 */

import { POST as createRoom } from '@/app/api/room/create/route';
import { POST as joinRoom } from '@/app/api/room/join/route';
import { NextRequest } from 'next/server';
import { createRoom as createRoomStore } from '@/app/lib/room-store';

// Mock dependencies
jest.mock('@/app/lib/room-store');
jest.mock('@/app/lib/jwt');
jest.mock('@/app/lib/rate-limit');
jest.mock('@/app/lib/code-enumeration');
jest.mock('@/app/lib/captcha');

describe('Room API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset sessionStorage
    (global.sessionStorage as any).getItem = jest.fn();
    (global.sessionStorage as any).setItem = jest.fn();
  });

  describe('POST /api/room/create', () => {
    it('should create a room successfully', async () => {
      const mockRoom = {
        code: '123456',
        createdAt: Date.now(),
        region: 'us-east',
        capacity: 27,
        hostPeerId: null,
        listeners: [],
        participants: new Map(),
        status: 'active' as const,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      };

      (createRoomStore as jest.Mock).mockReturnValue(mockRoom);

      const request = new NextRequest('http://localhost:3000/api/room/create', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '127.0.0.1',
        },
      });

      const response = await createRoom(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.code).toBe('123456');
      expect(data.formattedCode).toBe('123-456');
      expect(data.region).toBe('us-east');
    });

    it('should handle rate limiting', async () => {
      const { checkRateLimit } = require('@/app/lib/rate-limit');
      (checkRateLimit as jest.Mock).mockReturnValue(false);

      const request = new NextRequest('http://localhost:3000/api/room/create', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '127.0.0.1',
        },
      });

      const response = await createRoom(request);
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.error).toContain('Too many requests');
    });
  });

  describe('POST /api/room/join', () => {
    it('should join room successfully as first participant (host)', async () => {
      const { getRoom, isRoomActive, hasCapacity, setHost } = require('@/app/lib/room-store');
      const { generateToken } = require('@/app/lib/jwt');
      const { checkRateLimit } = require('@/app/lib/rate-limit');
      const { isCodeBeingEnumerated, isSuspiciousIP } = require('@/app/lib/code-enumeration');

      const mockRoom = {
        code: '123456',
        hostPeerId: null,
        listeners: [],
        participants: new Map(),
        capacity: 27,
        region: 'us-east',
      };

      (checkRateLimit as jest.Mock).mockReturnValue(true);
      (isCodeBeingEnumerated as jest.Mock).mockReturnValue(false);
      (isSuspiciousIP as jest.Mock).mockReturnValue(false);
      (isRoomActive as jest.Mock).mockReturnValue(true);
      (hasCapacity as jest.Mock).mockReturnValue(true);
      (getRoom as jest.Mock).mockReturnValue(mockRoom);
      (setHost as jest.Mock).mockImplementation(() => {
        mockRoom.hostPeerId = 'peer-1';
      });
      (generateToken as jest.Mock).mockReturnValue('mock-token');

      const request = new NextRequest('http://localhost:3000/api/room/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '127.0.0.1',
        },
        body: JSON.stringify({ code: '123456' }),
      });

      const response = await joinRoom(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.role).toBe('host');
      expect(data.code).toBe('123456');
      expect(data.token).toBe('mock-token');
    });

    it('should join room as listener when host exists', async () => {
      const { getRoom, isRoomActive, hasCapacity, addListener } = require('@/app/lib/room-store');
      const { generateToken } = require('@/app/lib/jwt');
      const { checkRateLimit } = require('@/app/lib/rate-limit');
      const { isCodeBeingEnumerated, isSuspiciousIP } = require('@/app/lib/code-enumeration');

      const mockRoom = {
        code: '123456',
        hostPeerId: 'host-1',
        listeners: [],
        participants: new Map(),
        capacity: 27,
        region: 'us-east',
      };

      (checkRateLimit as jest.Mock).mockReturnValue(true);
      (isCodeBeingEnumerated as jest.Mock).mockReturnValue(false);
      (isSuspiciousIP as jest.Mock).mockReturnValue(false);
      (isRoomActive as jest.Mock).mockReturnValue(true);
      (hasCapacity as jest.Mock).mockReturnValue(true);
      (getRoom as jest.Mock).mockReturnValue(mockRoom);
      (addListener as jest.Mock).mockImplementation(() => {
        mockRoom.listeners.push('listener-1');
      });
      (generateToken as jest.Mock).mockReturnValue('mock-token');

      const request = new NextRequest('http://localhost:3000/api/room/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '127.0.0.1',
        },
        body: JSON.stringify({ code: '123456' }),
      });

      const response = await joinRoom(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.role).toBe('listener');
    });

    it('should reject invalid room code format', async () => {
      const { checkRateLimit } = require('@/app/lib/rate-limit');
      (checkRateLimit as jest.Mock).mockReturnValue(true);

      const request = new NextRequest('http://localhost:3000/api/room/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '127.0.0.1',
        },
        body: JSON.stringify({ code: 'invalid' }),
      });

      const response = await joinRoom(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid room code format');
    });

    it('should reject non-existent room', async () => {
      const { isRoomActive, recordFailedAttempt } = require('@/app/lib/room-store');
      const { checkRateLimit } = require('@/app/lib/rate-limit');
      const { isCodeBeingEnumerated, isSuspiciousIP } = require('@/app/lib/code-enumeration');

      (checkRateLimit as jest.Mock).mockReturnValue(true);
      (isCodeBeingEnumerated as jest.Mock).mockReturnValue(false);
      (isSuspiciousIP as jest.Mock).mockReturnValue(false);
      (isRoomActive as jest.Mock).mockReturnValue(false);
      (recordFailedAttempt as jest.Mock).mockImplementation(() => {});

      const request = new NextRequest('http://localhost:3000/api/room/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '127.0.0.1',
        },
        body: JSON.stringify({ code: '999999' }),
      });

      const response = await joinRoom(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain('not found');
    });

    it('should reject joining full room', async () => {
      const { getRoom, isRoomActive, hasCapacity } = require('@/app/lib/room-store');
      const { checkRateLimit } = require('@/app/lib/rate-limit');
      const { isCodeBeingEnumerated, isSuspiciousIP } = require('@/app/lib/code-enumeration');

      (checkRateLimit as jest.Mock).mockReturnValue(true);
      (isCodeBeingEnumerated as jest.Mock).mockReturnValue(false);
      (isSuspiciousIP as jest.Mock).mockReturnValue(false);
      (isRoomActive as jest.Mock).mockReturnValue(true);
      (hasCapacity as jest.Mock).mockReturnValue(false);
      (getRoom as jest.Mock).mockReturnValue({
        code: '123456',
        capacity: 27,
      });

      const request = new NextRequest('http://localhost:3000/api/room/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '127.0.0.1',
        },
        body: JSON.stringify({ code: '123456' }),
      });

      const response = await joinRoom(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('full');
    });
  });
});

