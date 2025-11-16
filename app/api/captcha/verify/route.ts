import { NextRequest, NextResponse } from 'next/server';
import { verifyCaptcha } from '@/app/lib/captcha';

/**
 * POST /api/captcha/verify
 * Verifies CAPTCHA answer
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, answer } = body;

    if (!sessionId || answer === undefined) {
      return NextResponse.json(
        { error: 'Session ID and answer are required' },
        { status: 400 }
      );
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';

    const result = verifyCaptcha(sessionId, Number(answer), ip);

    if (result.valid) {
      return NextResponse.json({
        valid: true,
        message: 'CAPTCHA verified successfully',
      });
    }

    if (result.requiresNewChallenge) {
      return NextResponse.json(
        {
          valid: false,
          requiresNewChallenge: true,
          message: 'CAPTCHA expired or too many attempts. Please request a new challenge.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        valid: false,
        message: 'Incorrect answer. Please try again.',
      },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error verifying CAPTCHA:', error);
    return NextResponse.json(
      { error: 'Failed to verify CAPTCHA' },
      { status: 500 }
    );
  }
}

