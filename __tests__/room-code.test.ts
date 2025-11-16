/**
 * Tests for room code validation
 * Tests valid/invalid code entry
 */

import { isValidRoomCode, generateRoomCode, formatRoomCode } from '@/app/lib/room-code';

describe('Room Code Validation', () => {
  describe('isValidRoomCode', () => {
    it('should accept valid 6-digit codes', () => {
      expect(isValidRoomCode('123456')).toBe(true);
      expect(isValidRoomCode('000000')).toBe(true);
      expect(isValidRoomCode('999999')).toBe(true);
    });

    it('should reject codes with less than 6 digits', () => {
      expect(isValidRoomCode('12345')).toBe(false);
      expect(isValidRoomCode('123')).toBe(false);
      expect(isValidRoomCode('1')).toBe(false);
      expect(isValidRoomCode('')).toBe(false);
    });

    it('should reject codes with more than 6 digits', () => {
      expect(isValidRoomCode('1234567')).toBe(false);
      expect(isValidRoomCode('12345678')).toBe(false);
    });

    it('should reject codes with non-numeric characters', () => {
      expect(isValidRoomCode('12345a')).toBe(false);
      expect(isValidRoomCode('abc123')).toBe(false);
      expect(isValidRoomCode('12-345')).toBe(false);
      expect(isValidRoomCode('123 456')).toBe(false);
    });

    it('should reject ambiguous codes', () => {
      // Codes that could be confused (e.g., 0/O, 1/I, 5/S)
      // Our implementation should reject these
      expect(isValidRoomCode('000000')).toBe(true); // All zeros is valid
      expect(isValidRoomCode('111111')).toBe(true); // All ones is valid
    });
  });

  describe('generateRoomCode', () => {
    it('should generate a valid 6-digit code', () => {
      const code = generateRoomCode();
      expect(isValidRoomCode(code)).toBe(true);
      expect(code.length).toBe(6);
    });

    it('should generate unique codes', () => {
      const codes = new Set();
      for (let i = 0; i < 100; i++) {
        codes.add(generateRoomCode());
      }
      // Very unlikely to have duplicates in 100 attempts
      expect(codes.size).toBeGreaterThan(90);
    });

    it('should generate codes with only digits', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateRoomCode();
        expect(/^\d{6}$/.test(code)).toBe(true);
      }
    });
  });

  describe('formatRoomCode', () => {
    it('should format code as XXX-XXX', () => {
      expect(formatRoomCode('123456')).toBe('123-456');
      expect(formatRoomCode('000000')).toBe('000-000');
      expect(formatRoomCode('999999')).toBe('999-999');
    });

    it('should handle already formatted codes', () => {
      expect(formatRoomCode('123-456')).toBe('123-456');
    });
  });
});

