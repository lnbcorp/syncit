/**
 * WebRTC configuration with STUN/TURN servers
 */

export interface RTCConfig {
  iceServers: {
    urls: string | string[];
    username?: string;
    credential?: string;
  }[];
  ttl?: number;
  expiresAt?: number;
}

/**
 * Get RTC configuration for WebRTC connections
 * Fetches TURN credentials from API if available, otherwise uses STUN only
 */
export async function getRTCConfig(): Promise<RTCConfig> {
  try {
    // Try to fetch TURN credentials from API
    const response = await fetch('/api/turn/credentials', {
      method: 'GET',
    });

    if (response.ok) {
      const data = await response.json();
      return data;
    }
  } catch (error) {
    console.warn('Failed to fetch TURN credentials, using STUN only:', error);
  }

  // Fallback to STUN only if TURN credentials unavailable
  return {
    iceServers: [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
        ],
      },
    ],
  };
}

/**
 * Get basic RTC config (STUN only) - for server-side use
 */
export function getBasicRTCConfig(): RTCConfig {
  return {
    iceServers: [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
        ],
      },
    ],
  };
}

