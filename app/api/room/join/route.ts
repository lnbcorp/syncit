import { NextRequest, NextResponse } from 'next/server';
import { 
  getRoom, 
  isRoomActive, 
  hasCapacity, 
  setHost, 
  addListener 
} from '@/app/lib/room-store';
import { isValidRoomCode } from '@/app/lib/room-code';
import { generateToken } from '@/app/lib/jwt';
import { checkRateLimit } from '@/app/lib/rate-limit';
import { getBasicRTCConfig } from '@/app/lib/rtc-config';
import { randomUUID } from 'crypto';
import {
  recordFailedAttempt,
  isCodeBeingEnumerated,
  isSuspiciousIP,
  getUniqueCodesAttempted,
  resetCodeEnumeration,
} from '@/app/lib/code-enumeration';
import { generateCaptcha, verifyCaptcha } from '@/app/lib/captcha';

/**
 * POST /api/room/join
 * Validates room code and returns WebRTC config and token
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting: 60 attempts per IP per hour
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip') 
      || 'unknown';
    const rateLimitKey = `join:${ip}`;
    
    if (!checkRateLimit(rateLimitKey, 60, 60 * 60 * 1000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { code } = body;

    // Validate code format
    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Room code is required' },
        { status: 400 }
      );
    }

    // Remove dashes if present (XXX-XXX format)
    const cleanCode = code.replace(/-/g, '');

    // Validate 6-digit format
    if (!isValidRoomCode(cleanCode)) {
      return NextResponse.json(
        { error: 'Invalid room code format. Must be 6 digits.' },
        { status: 400 }
      );
    }

    // Check for code enumeration
    if (isCodeBeingEnumerated(cleanCode)) {
      return NextResponse.json(
        { error: 'Too many failed attempts for this room code. Please try again later.' },
        { status: 429 }
      );
    }

    // Check if IP is suspicious
    if (isSuspiciousIP(ip)) {
      const uniqueCodes = getUniqueCodesAttempted(ip);
      if (uniqueCodes >= 5) {
        // Require CAPTCHA for suspicious IPs
        const { sessionId, question } = generateCaptcha();
        return NextResponse.json(
          {
            error: 'CAPTCHA required due to suspicious activity',
            requiresCaptcha: true,
            captchaSessionId: sessionId,
            captchaQuestion: question,
          },
          { status: 429 }
        );
      }
    }

    // Check if room exists and is active
    if (!isRoomActive(cleanCode)) {
      // Record failed attempt for enumeration detection
      recordFailedAttempt(cleanCode, ip);
      
      return NextResponse.json(
        { error: 'Room not found or has expired' },
        { status: 404 }
      );
    }

    // Check room capacity
    if (!hasCapacity(cleanCode)) {
      return NextResponse.json(
        { error: 'Room is full (maximum 27 participants)' },
        { status: 403 }
      );
    }

    // Reset enumeration tracking on successful join
    resetCodeEnumeration(cleanCode);

    const room = getRoom(cleanCode);
    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    // Generate peer ID
    const peerId = randomUUID();

    // Determine role: first entrant becomes Host
    let role: 'host' | 'listener';
    const deviceHints = {
      userAgent: request.headers.get('user-agent') || undefined,
    };
    
    if (!room.hostPeerId) {
      // First entrant becomes Host
      role = 'host';
      setHost(cleanCode, peerId, deviceHints);
    } else {
      // Subsequent entrants become Listeners
      role = 'listener';
      addListener(cleanCode, peerId, deviceHints);
    }

    // Generate JWT token
    const token = generateToken({
      roomCode: cleanCode,
      role,
      peerId,
    });

    // Get basic RTC configuration (STUN only)
    // Clients should fetch TURN credentials separately from /api/turn/credentials
    const rtcConfig = getBasicRTCConfig();

    // TODO: Get actual SFU endpoint (will be added when SFU is set up)
    const sfuEndpoint = process.env.SFU_ENDPOINT || 'wss://sfu.example.com';

    return NextResponse.json({
      role,
      code: cleanCode,
      peerId,
      token,
      rtcConfig,
      sfuEndpoint,
      room: {
        code: cleanCode,
        region: room.region,
        capacity: room.capacity,
        currentParticipants: (room.hostPeerId ? 1 : 0) + room.listeners.length,
      },
    });
  } catch (error) {
    console.error('Error joining room:', error);
    return NextResponse.json(
      { error: 'Failed to join room' },
      { status: 500 }
    );
  }
}

