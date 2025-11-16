/**
 * Code Enumeration Detection
 * Detects and prevents brute-force attempts to enumerate room codes
 */

interface EnumerationAttempt {
  code: string;
  timestamp: number;
  ip: string;
}

interface EnumerationStats {
  failedAttempts: number;
  lastAttempt: number;
  suspiciousIPs: Set<string>;
}

const enumerationAttempts = new Map<string, EnumerationAttempt[]>(); // code -> attempts
const ipStats = new Map<string, EnumerationStats>(); // ip -> stats

// Thresholds
const MAX_FAILED_ATTEMPTS_PER_CODE = 3; // After 3 failed attempts, code is "locked"
const CODE_LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const SUSPICIOUS_IP_THRESHOLD = 10; // 10 failed attempts from same IP
const ENUMERATION_WINDOW_MS = 60 * 60 * 1000; // 1 hour window

/**
 * Record a failed join attempt
 */
export function recordFailedAttempt(code: string, ip: string): void {
  const now = Date.now();
  
  // Record attempt for this code
  if (!enumerationAttempts.has(code)) {
    enumerationAttempts.set(code, []);
  }
  enumerationAttempts.get(code)!.push({
    code,
    timestamp: now,
    ip,
  });

  // Update IP stats
  if (!ipStats.has(ip)) {
    ipStats.set(ip, {
      failedAttempts: 0,
      lastAttempt: 0,
      suspiciousIPs: new Set(),
    });
  }
  const stats = ipStats.get(ip)!;
  stats.failedAttempts++;
  stats.lastAttempt = now;

  // Clean up old attempts
  cleanupOldAttempts();
}

/**
 * Check if a code is being enumerated (too many failed attempts)
 */
export function isCodeBeingEnumerated(code: string): boolean {
  const attempts = enumerationAttempts.get(code);
  if (!attempts || attempts.length === 0) {
    return false;
  }

  const now = Date.now();
  const recentAttempts = attempts.filter(
    a => now - a.timestamp < CODE_LOCK_DURATION_MS
  );

  return recentAttempts.length >= MAX_FAILED_ATTEMPTS_PER_CODE;
}

/**
 * Check if an IP is suspicious (too many failed attempts across different codes)
 */
export function isSuspiciousIP(ip: string): boolean {
  const stats = ipStats.get(ip);
  if (!stats) {
    return false;
  }

  const now = Date.now();
  
  // Check if IP has made many failed attempts recently
  if (stats.failedAttempts >= SUSPICIOUS_IP_THRESHOLD) {
    // Check if attempts are within the window
    if (now - stats.lastAttempt < ENUMERATION_WINDOW_MS) {
      return true;
    }
  }

  return false;
}

/**
 * Get number of unique codes an IP has attempted
 */
export function getUniqueCodesAttempted(ip: string): number {
  const codes = new Set<string>();
  const now = Date.now();
  const windowStart = now - ENUMERATION_WINDOW_MS;

  for (const [code, attempts] of enumerationAttempts.entries()) {
    const ipAttempts = attempts.filter(
      a => a.ip === ip && a.timestamp >= windowStart
    );
    if (ipAttempts.length > 0) {
      codes.add(code);
    }
  }

  return codes.size;
}

/**
 * Clean up old enumeration attempts
 */
function cleanupOldAttempts(): void {
  const now = Date.now();
  const cutoff = now - ENUMERATION_WINDOW_MS;

  // Clean up old attempts per code
  for (const [code, attempts] of enumerationAttempts.entries()) {
    const recent = attempts.filter(a => a.timestamp >= cutoff);
    if (recent.length === 0) {
      enumerationAttempts.delete(code);
    } else {
      enumerationAttempts.set(code, recent);
    }
  }

  // Clean up old IP stats
  for (const [ip, stats] of ipStats.entries()) {
    if (now - stats.lastAttempt > ENUMERATION_WINDOW_MS) {
      ipStats.delete(ip);
    }
  }
}

/**
 * Reset enumeration tracking for a code (when successfully joined)
 */
export function resetCodeEnumeration(code: string): void {
  enumerationAttempts.delete(code);
}

// Clean up every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupOldAttempts, 10 * 60 * 1000);
}

