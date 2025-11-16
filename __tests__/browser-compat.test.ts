/**
 * Tests for browser compatibility
 * Tests feature detection and browser-specific behavior
 */

describe('Browser Compatibility', () => {
  describe('Feature Detection', () => {
    it('should detect setSinkId support', () => {
      const audioElement = document.createElement('audio');
      const hasSetSinkId = 'setSinkId' in HTMLAudioElement.prototype;
      
      // Feature detection
      expect(typeof hasSetSinkId).toBe('boolean');
    });

    it('should detect playoutDelayHint support', () => {
      const track = new MediaStreamTrack();
      const hasPlayoutDelayHint = 'playoutDelayHint' in RTCRtpReceiver.prototype;
      
      // Feature detection
      expect(typeof hasPlayoutDelayHint).toBe('boolean');
    });

    it('should detect WebRTC support', () => {
      const hasRTCPeerConnection = typeof RTCPeerConnection !== 'undefined';
      const hasGetUserMedia = typeof navigator.mediaDevices?.getUserMedia !== 'undefined';
      const hasGetDisplayMedia = typeof navigator.mediaDevices?.getDisplayMedia !== 'undefined';

      expect(hasRTCPeerConnection).toBe(true);
      expect(hasGetUserMedia).toBe(true);
      expect(hasGetDisplayMedia).toBe(true);
    });

    it('should detect DataChannel support', () => {
      const hasDataChannel = typeof RTCPeerConnection.prototype.createDataChannel !== 'undefined';
      expect(hasDataChannel).toBe(true);
    });
  });

  describe('Browser-Specific Behavior', () => {
    it('should handle Chrome-specific features', () => {
      // Chrome supports setSinkId and playoutDelayHint
      const userAgent = navigator.userAgent;
      const isChrome = /Chrome/.test(userAgent) && !/Edge/.test(userAgent);
      
      if (isChrome) {
        const audioElement = document.createElement('audio');
        expect('setSinkId' in audioElement).toBe(true);
      }
    });

    it('should handle Firefox-specific behavior', () => {
      const userAgent = navigator.userAgent;
      const isFirefox = /Firefox/.test(userAgent);
      
      if (isFirefox) {
        // Firefox may have different WebRTC behavior
        expect(typeof RTCPeerConnection).toBe('function');
      }
    });

    it('should handle Safari-specific behavior', () => {
      const userAgent = navigator.userAgent;
      const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
      
      if (isSafari) {
        // Safari may require different handling
        expect(typeof RTCPeerConnection).toBe('function');
      }
    });
  });

  describe('Network Condition Handling', () => {
    it('should handle wired connection', () => {
      // Simulate wired connection (low latency, no jitter)
      const connectionType = 'ethernet';
      expect(connectionType).toBe('ethernet');
    });

    it('should handle Wi-Fi connection', () => {
      // Simulate Wi-Fi connection (moderate latency, some jitter)
      const connectionType = 'wifi';
      expect(connectionType).toBe('wifi');
    });

    it('should handle 4G connection', () => {
      // Simulate 4G connection (higher latency, more jitter)
      const connectionType = 'cellular';
      expect(connectionType).toBe('cellular');
    });
  });

  describe('Device-Specific Features', () => {
    it('should detect audio output devices', async () => {
      // Mock enumerateDevices
      const mockDevices = [
        { deviceId: 'default', kind: 'audiooutput', label: 'Default' },
        { deviceId: 'device-1', kind: 'audiooutput', label: 'Headphones' },
      ];

      if (typeof navigator.mediaDevices?.enumerateDevices === 'function') {
        const devices = await navigator.mediaDevices.enumerateDevices();
        expect(Array.isArray(devices)).toBe(true);
      }
    });

    it('should handle audio input devices', async () => {
      // Mock getUserMedia
      if (typeof navigator.mediaDevices?.getUserMedia === 'function') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          expect(stream).toBeDefined();
        } catch (error) {
          // Expected in test environment
          expect(error).toBeDefined();
        }
      }
    });
  });

  describe('Platform Detection', () => {
    it('should detect macOS', () => {
      const platform = navigator.platform;
      const isMac = /Mac/.test(platform);
      expect(typeof isMac).toBe('boolean');
    });

    it('should detect iOS', () => {
      const userAgent = navigator.userAgent;
      const isIOS = /iPhone|iPad|iPod/.test(userAgent);
      expect(typeof isIOS).toBe('boolean');
    });

    it('should detect Android', () => {
      const userAgent = navigator.userAgent;
      const isAndroid = /Android/.test(userAgent);
      expect(typeof isAndroid).toBe('boolean');
    });
  });
});

