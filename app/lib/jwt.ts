import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-use-strong-secret';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h'; // Short-lived tokens: 1 hour default

export interface TokenPayload {
  roomCode: string;
  role: 'host' | 'listener';
  peerId: string;
}

/**
 * Generate JWT token for room participant
 */
export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });
}

/**
 * Verify and decode JWT token
 * Handles token expiry and invalid tokens
 */
export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    
    // Validate required fields
    if (!decoded.roomCode || !decoded.role || !decoded.peerId) {
      throw new Error('Invalid token payload');
    }
    
    // Validate role
    if (decoded.role !== 'host' && decoded.role !== 'listener') {
      throw new Error('Invalid role in token');
    }
    
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw new Error('Token verification failed');
  }
}

