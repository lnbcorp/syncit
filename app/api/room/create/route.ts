import { NextRequest, NextResponse } from 'next/server';
import { createRoom } from '@/app/lib/room-store';
import { formatRoomCode } from '@/app/lib/room-code';
import { checkRateLimit } from '@/app/lib/rate-limit';

/**
 * POST /api/room/create
 * Creates a new room and returns the room code and host token
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting: 10 attempts per IP per minute
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip') 
      || 'unknown';
    const rateLimitKey = `create:${ip}`;
    
    if (!checkRateLimit(rateLimitKey, 10, 60 * 1000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Create room (default region, can be enhanced with geo-detection)
    const region = 'us-east'; // TODO: Detect region from request
    const room = createRoom(region);
    
    // Note: Host is not set here. First person to join will become host.
    // The creator will need to join the room to become the host.

    return NextResponse.json({
      code: room.code,
      formattedCode: formatRoomCode(room.code),
      region: room.region,
      expiresAt: room.expiresAt,
    });
  } catch (error) {
    console.error('Error creating room:', error);
    return NextResponse.json(
      { error: 'Failed to create room' },
      { status: 500 }
    );
  }
}

