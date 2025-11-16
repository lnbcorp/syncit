import { NextRequest, NextResponse } from 'next/server';
import { generateTURNCredentials } from '@/app/lib/turn-credentials';
import { checkRateLimit } from '@/app/lib/rate-limit';

const TURN_SERVER = process.env.TURN_SERVER || 'turn:turn.example.com:3478';
const TURN_SERVER_TLS = process.env.TURN_SERVER_TLS || 'turns:turn.example.com:5349';

/**
 * GET /api/turn/credentials
 * Generates short-lived TURN credentials for WebRTC connections
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limiting: 30 requests per IP per minute
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip') 
      || 'unknown';
    const rateLimitKey = `turn:${ip}`;
    
    if (!checkRateLimit(rateLimitKey, 30, 60 * 1000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Generate ephemeral TURN credentials
    const credentials = generateTURNCredentials();

    // Return STUN/TURN server configuration
    return NextResponse.json({
      iceServers: [
        // Public STUN servers (always available)
        {
          urls: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
            'stun:stun2.l.google.com:19302',
          ],
        },
        // TURN UDP server
        {
          urls: TURN_SERVER,
          username: credentials.username,
          credential: credentials.password,
        },
        // TURN TCP/TLS server (fallback)
        {
          urls: TURN_SERVER_TLS,
          username: credentials.username,
          credential: credentials.password,
        },
      ],
      ttl: credentials.ttl,
      expiresAt: Date.now() + (credentials.ttl * 1000),
    });
  } catch (error) {
    console.error('Error generating TURN credentials:', error);
    return NextResponse.json(
      { error: 'Failed to generate TURN credentials' },
      { status: 500 }
    );
  }
}

