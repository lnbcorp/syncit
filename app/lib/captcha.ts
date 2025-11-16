/**
 * Simple CAPTCHA Challenge
 * Basic CAPTCHA implementation for rate limiting
 */

interface CaptchaChallenge {
  question: string;
  answer: number;
  expiresAt: number;
}

interface CaptchaSession {
  challenge: CaptchaChallenge;
  attempts: number;
  ip: string;
}

const captchaSessions = new Map<string, CaptchaSession>(); // sessionId -> session
const CAPTCHA_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CAPTCHA_ATTEMPTS = 3;

/**
 * Generate a simple math CAPTCHA challenge
 */
export function generateCaptcha(): { sessionId: string; question: string } {
  const sessionId = `captcha_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Simple math problem: a + b = ?
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  const answer = a + b;
  
  const challenge: CaptchaChallenge = {
    question: `${a} + ${b} = ?`,
    answer,
    expiresAt: Date.now() + CAPTCHA_DURATION_MS,
  };

  captchaSessions.set(sessionId, {
    challenge,
    attempts: 0,
    ip: '', // Will be set when verified
  });

  return {
    sessionId,
    question: challenge.question,
  };
}

/**
 * Verify CAPTCHA answer
 */
export function verifyCaptcha(sessionId: string, answer: number, ip: string): {
  valid: boolean;
  requiresNewChallenge: boolean;
} {
  const session = captchaSessions.get(sessionId);
  
  if (!session) {
    return { valid: false, requiresNewChallenge: true };
  }

  // Check if expired
  if (Date.now() > session.challenge.expiresAt) {
    captchaSessions.delete(sessionId);
    return { valid: false, requiresNewChallenge: true };
  }

  // Set IP if not set
  if (!session.ip) {
    session.ip = ip;
  }

  // Check IP match
  if (session.ip !== ip) {
    return { valid: false, requiresNewChallenge: false };
  }

  // Increment attempts
  session.attempts++;

  // Check answer
  if (answer === session.challenge.answer) {
    // Valid - remove session
    captchaSessions.delete(sessionId);
    return { valid: true, requiresNewChallenge: false };
  }

  // Invalid answer
  if (session.attempts >= MAX_CAPTCHA_ATTEMPTS) {
    // Too many attempts - require new challenge
    captchaSessions.delete(sessionId);
    return { valid: false, requiresNewChallenge: true };
  }

  return { valid: false, requiresNewChallenge: false };
}

/**
 * Clean up expired CAPTCHA sessions
 */
export function cleanupCaptchaSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of captchaSessions.entries()) {
    if (now > session.challenge.expiresAt) {
      captchaSessions.delete(sessionId);
    }
  }
}

// Clean up every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupCaptchaSessions, 5 * 60 * 1000);
}

