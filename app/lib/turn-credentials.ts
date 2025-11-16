import crypto from 'crypto';

/**
 * Generate TURN credentials using TURN REST API specification
 * Based on RFC 8489 (TURN REST API)
 */

const TURN_SECRET = process.env.TURN_SECRET || 'change-me-in-production-use-strong-secret';
const TURN_SERVER = process.env.TURN_SERVER || 'turn:turn.example.com:3478';
const TURN_USERNAME_PREFIX = process.env.TURN_USERNAME_PREFIX || 'pulsecast';
const TURN_CREDENTIAL_TTL = 10 * 60; // 10 minutes in seconds

/**
 * Generate TURN username and password using HMAC
 * Username format: timestamp:username_prefix
 * Password: HMAC-SHA1(secret, username)
 */
export function generateTURNCredentials(): {
  username: string;
  password: string;
  ttl: number;
} {
  const timestamp = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL;
  const username = `${timestamp}:${TURN_USERNAME_PREFIX}`;
  
  // Generate password using HMAC-SHA1
  const hmac = crypto.createHmac('sha1', TURN_SECRET);
  hmac.update(username);
  const password = hmac.digest('base64');

  return {
    username,
    password,
    ttl: TURN_CREDENTIAL_TTL,
  };
}

/**
 * Validate TURN credentials (for server-side validation if needed)
 */
export function validateTURNCredentials(
  username: string,
  password: string
): boolean {
  try {
    // Extract timestamp from username
    const parts = username.split(':');
    if (parts.length !== 2) return false;

    const timestamp = parseInt(parts[0], 10);
    const now = Math.floor(Date.now() / 1000);

    // Check if credentials have expired
    if (timestamp < now) {
      return false;
    }

    // Verify password matches
    const hmac = crypto.createHmac('sha1', TURN_SECRET);
    hmac.update(username);
    const expectedPassword = hmac.digest('base64');

    return password === expectedPassword;
  } catch (error) {
    return false;
  }
}

