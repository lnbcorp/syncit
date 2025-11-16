/**
 * Generates a unique 6-digit numeric room code
 * Rejects ambiguous codes like 000000, 123123, etc.
 */
export function generateRoomCode(): string {
  const ambiguousCodes = new Set([
    '000000', '111111', '222222', '333333', '444444',
    '555555', '666666', '777777', '888888', '999999',
    '123123', '123456', '654321', '111222', '222111'
  ]);

  let code: string;
  let attempts = 0;
  const maxAttempts = 100;

  do {
    // Generate random 6-digit code
    code = Math.floor(100000 + Math.random() * 900000).toString();
    attempts++;
    
    if (attempts > maxAttempts) {
      throw new Error('Failed to generate unique room code');
    }
  } while (ambiguousCodes.has(code));

  return code;
}

/**
 * Formats a 6-digit code as XXX-XXX
 */
export function formatRoomCode(code: string): string {
  if (code.length !== 6) {
    return code;
  }
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/**
 * Validates a room code format
 */
export function isValidRoomCode(code: string): boolean {
  return /^[0-9]{6}$/.test(code);
}

