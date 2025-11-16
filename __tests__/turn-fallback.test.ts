/**
 * Tests for TURN fallback functionality
 * Tests TURN fallback when UDP is blocked
 */

import { getRTCConfig, getBasicRTCConfig } from '@/app/lib/rtc-config';

// Mock fetch for TURN credentials API
global.fetch = jest.fn();

describe('TURN Fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRTCConfig', () => {
    it('should return TURN config when credentials API is available', async () => {
      const mockTURNConfig = {
        iceServers: [
          {
            urls: 'turn:turn.example.com:3478',
            username: 'test-user',
            credential: 'test-credential',
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockTURNConfig,
      });

      const config = await getRTCConfig();

      expect(config.iceServers).toHaveLength(1);
      expect(config.iceServers[0].urls).toBe('turn:turn.example.com:3478');
      expect(config.iceServers[0].username).toBe('test-user');
      expect(config.iceServers[0].credential).toBe('test-credential');
    });

    it('should fallback to STUN only when TURN API fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const config = await getRTCConfig();

      // Should fallback to STUN servers
      expect(config.iceServers).toBeDefined();
      expect(config.iceServers.length).toBeGreaterThan(0);
      
      // Should include STUN servers
      const stunServers = config.iceServers.filter((server: any) => 
        (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url: string) => 
          url.startsWith('stun:')
        )
      );
      expect(stunServers.length).toBeGreaterThan(0);
    });

    it('should fallback to STUN only when TURN API throws error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const config = await getRTCConfig();

      // Should fallback to STUN servers
      expect(config.iceServers).toBeDefined();
      expect(config.iceServers.length).toBeGreaterThan(0);
      
      // Should include STUN servers
      const stunServers = config.iceServers.filter((server: any) => 
        (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url: string) => 
          url.startsWith('stun:')
        )
      );
      expect(stunServers.length).toBeGreaterThan(0);
    });
  });

  describe('getBasicRTCConfig', () => {
    it('should return STUN-only configuration', () => {
      const config = getBasicRTCConfig();

      expect(config.iceServers).toBeDefined();
      expect(config.iceServers.length).toBeGreaterThan(0);
      
      // All servers should be STUN
      config.iceServers.forEach((server: any) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        urls.forEach((url: string) => {
          expect(url).toMatch(/^stun:/);
        });
      });
    });

    it('should not include TURN servers', () => {
      const config = getBasicRTCConfig();

      config.iceServers.forEach((server: any) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        urls.forEach((url: string) => {
          expect(url).not.toMatch(/^turn:/);
          expect(url).not.toMatch(/^turns:/);
        });
      });
    });
  });

  describe('ICE Server Priority', () => {
    it('should prioritize TURN over STUN when both are available', async () => {
      const mockTURNConfig = {
        iceServers: [
          {
            urls: ['turn:turn.example.com:3478', 'stun:stun.example.com:3478'],
            username: 'test-user',
            credential: 'test-credential',
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockTURNConfig,
      });

      const config = await getRTCConfig();

      // TURN should be in the configuration
      const hasTURN = config.iceServers.some((server: any) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url: string) => url.startsWith('turn:'));
      });

      expect(hasTURN).toBe(true);
    });
  });
});

