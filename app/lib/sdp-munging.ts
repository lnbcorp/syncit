/**
 * SDP Munging Utilities
 * Enforces Opus codec configuration for low-latency audio streaming
 */

export interface OpusConfig {
  sampleRate: number; // 48000
  ptime: number; // 5ms
  maxptime: number; // 10ms
  fec: boolean; // true (enable FEC)
  dtx: boolean; // false (disable DTX)
  minBitrate?: number; // 32000 (32 kbps)
  maxBitrate?: number; // 64000 (64 kbps)
}

const DEFAULT_OPUS_CONFIG: OpusConfig = {
  sampleRate: 48000,
  ptime: 5,
  maxptime: 10,
  fec: true,
  dtx: false,
  minBitrate: 32000,
  maxBitrate: 64000,
};

/**
 * Munge SDP to enforce Opus codec configuration
 */
export function mungeSDPForOpus(sdp: string, config: OpusConfig = DEFAULT_OPUS_CONFIG): string {
  let mungedSDP = sdp;

  // Ensure Opus is the preferred codec
  mungedSDP = setOpusAsPreferredCodec(mungedSDP);

  // Set Opus-specific parameters
  mungedSDP = setOpusParameters(mungedSDP, config);

  // Set bitrate constraints
  if (config.minBitrate || config.maxBitrate) {
    mungedSDP = setBitrateConstraints(mungedSDP, config.minBitrate, config.maxBitrate);
  }

  return mungedSDP;
}

/**
 * Set Opus as the preferred codec in SDP
 */
function setOpusAsPreferredCodec(sdp: string): string {
  const lines = sdp.split('\r\n');
  const mLineIndex = lines.findIndex(line => line.startsWith('m=audio'));

  if (mLineIndex === -1) {
    return sdp; // No audio m-line found
  }

  // Find all codec payload types
  const codecLines: { line: string; index: number; payloadType: string }[] = [];
  let currentIndex = mLineIndex + 1;

  // Collect all codec lines (rtpmap)
  while (currentIndex < lines.length && !lines[currentIndex].startsWith('m=')) {
    if (lines[currentIndex].startsWith('a=rtpmap:')) {
      const match = lines[currentIndex].match(/a=rtpmap:(\d+)\s+opus\/(\d+)/);
      if (match) {
        codecLines.push({
          line: lines[currentIndex],
          index: currentIndex,
          payloadType: match[1],
        });
      }
    }
    currentIndex++;
  }

  if (codecLines.length === 0) {
    return sdp; // No Opus codec found
  }

  // Get the Opus payload type
  const opusPayloadType = codecLines[0].payloadType;

  // Reorder m-line to put Opus first
  const mLine = lines[mLineIndex];
  const mLineParts = mLine.split(' ');
  const payloadTypes = mLineParts.slice(3); // Skip 'm=audio', port, and protocol

  // Remove Opus from current position and add it first
  const opusIndex = payloadTypes.indexOf(opusPayloadType);
  if (opusIndex !== -1) {
    payloadTypes.splice(opusIndex, 1);
  }
  payloadTypes.unshift(opusPayloadType);

  // Reconstruct m-line
  lines[mLineIndex] = `${mLineParts[0]} ${mLineParts[1]} ${mLineParts[2]} ${payloadTypes.join(' ')}`;

  return lines.join('\r\n');
}

/**
 * Set Opus-specific parameters in SDP
 */
function setOpusParameters(sdp: string, config: OpusConfig): string {
  const lines = sdp.split('\r\n');
  let mungedLines: string[] = [];
  let foundOpusFmtp = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Find Opus fmtp line
    if (line.startsWith('a=fmtp:') && line.includes('opus')) {
      foundOpusFmtp = true;
      // Parse existing fmtp parameters
      const fmtpMatch = line.match(/a=fmtp:(\d+)\s+(.+)/);
      if (fmtpMatch) {
        const payloadType = fmtpMatch[1];
        const existingParams = fmtpMatch[2];

        // Parse existing parameters
        const params = new Map<string, string>();
        existingParams.split(';').forEach(param => {
          const [key, value] = param.split('=').map(s => s.trim());
          if (key && value) {
            params.set(key, value);
          }
        });

        // Set Opus parameters
        params.set('ptime', config.ptime.toString());
        params.set('maxptime', config.maxptime.toString());
        params.set('useinbandfec', config.fec ? '1' : '0');
        params.set('usedtx', config.dtx ? '1' : '0');
        params.set('stereo', '0'); // Mono
        params.set('sprop-stereo', '0');

        // Reconstruct fmtp line
        const paramString = Array.from(params.entries())
          .map(([key, value]) => `${key}=${value}`)
          .join(';');
        mungedLines.push(`a=fmtp:${payloadType} ${paramString}`);
      } else {
        mungedLines.push(line);
      }
    } else {
      mungedLines.push(line);
    }
  }

  // If no fmtp line found, add one (find Opus payload type first)
  if (!foundOpusFmtp) {
    const opusPayloadType = findOpusPayloadType(sdp);
    if (opusPayloadType) {
      // Find the position after the rtpmap line for Opus
      const rtpmapIndex = mungedLines.findIndex(
        line => line.startsWith(`a=rtpmap:${opusPayloadType}`) && line.includes('opus')
      );
      if (rtpmapIndex !== -1) {
        const fmtpLine = `a=fmtp:${opusPayloadType} ptime=${config.ptime};maxptime=${config.maxptime};useinbandfec=${config.fec ? 1 : 0};usedtx=${config.dtx ? 1 : 0};stereo=0;sprop-stereo=0`;
        mungedLines.splice(rtpmapIndex + 1, 0, fmtpLine);
      }
    }
  }

  return mungedLines.join('\r\n');
}

/**
 * Set bitrate constraints in SDP
 */
function setBitrateConstraints(sdp: string, minBitrate?: number, maxBitrate?: number): string {
  const lines = sdp.split('\r\n');
  const mungedLines: string[] = [];
  let foundBitrate = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Find or replace bitrate constraint
    if (line.startsWith('a=fmtp:') && line.includes('opus')) {
      foundBitrate = true;
      const fmtpMatch = line.match(/a=fmtp:(\d+)\s+(.+)/);
      if (fmtpMatch) {
        const payloadType = fmtpMatch[1];
        const existingParams = fmtpMatch[2];

        // Parse existing parameters
        const params = new Map<string, string>();
        existingParams.split(';').forEach(param => {
          const [key, value] = param.split('=').map(s => s.trim());
          if (key && value) {
            params.set(key, value);
          }
        });

        // Set bitrate constraints
        if (maxBitrate) {
          // Opus bitrate is set via maxaveragebitrate
          params.set('maxaveragebitrate', maxBitrate.toString());
        }
        if (minBitrate) {
          // Opus minimum bitrate is set via minptime (packet time in ms)
          // For low latency, we keep minptime at 5ms, but we can also set maxaveragebitrate
          // Note: minptime is about packet duration, not bitrate directly
          // We'll set maxaveragebitrate for minimum bitrate control
          if (!params.has('maxaveragebitrate')) {
            params.set('maxaveragebitrate', minBitrate.toString());
          }
        }

        // Reconstruct fmtp line
        const paramString = Array.from(params.entries())
          .map(([key, value]) => `${key}=${value}`)
          .join(';');
        mungedLines.push(`a=fmtp:${payloadType} ${paramString}`);
      } else {
        mungedLines.push(line);
      }
    } else {
      mungedLines.push(line);
    }
  }

  // If no fmtp line found, add bitrate constraints to existing fmtp or create new one
  if (!foundBitrate) {
    const opusPayloadType = findOpusPayloadType(sdp);
    if (opusPayloadType) {
      const rtpmapIndex = mungedLines.findIndex(
        line => line.startsWith(`a=rtpmap:${opusPayloadType}`) && line.includes('opus')
      );
      if (rtpmapIndex !== -1) {
        const bitrateParams: string[] = [];
        if (maxBitrate) {
          bitrateParams.push(`maxaveragebitrate=${maxBitrate}`);
        }
        if (minBitrate && !maxBitrate) {
          // If only minBitrate is set, use it as maxaveragebitrate
          bitrateParams.push(`maxaveragebitrate=${minBitrate}`);
        }
        if (bitrateParams.length > 0) {
          const fmtpLine = `a=fmtp:${opusPayloadType} ${bitrateParams.join(';')}`;
          mungedLines.splice(rtpmapIndex + 1, 0, fmtpLine);
        }
      }
    }
  }

  return mungedLines.join('\r\n');
}

/**
 * Find Opus payload type in SDP
 */
function findOpusPayloadType(sdp: string): string | null {
  const lines = sdp.split('\r\n');
  for (const line of lines) {
    const match = line.match(/a=rtpmap:(\d+)\s+opus\/(\d+)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Munge SDP answer for receive-only configuration (listeners)
 * Ensures Opus is preferred and low-latency settings are maintained
 */
export function mungeSDPForReception(sdp: string): string {
  // For listeners, we mainly want to ensure Opus is preferred
  // The SDP answer should already have the right format from the offer
  // But we can still optimize it
  return setOpusAsPreferredCodec(sdp);
}

/**
 * Apply bitrate constraints to RTCRtpSender
 */
export async function applyBitrateConstraints(
  sender: RTCRtpSender,
  minBitrate?: number,
  maxBitrate?: number
): Promise<void> {
  if (!sender.track) {
    throw new Error('RTCRtpSender has no track');
  }

  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }

  // Apply bitrate constraints to all encodings
  for (const encoding of params.encodings) {
    if (minBitrate !== undefined) {
      encoding.minBitrate = minBitrate;
    }
    if (maxBitrate !== undefined) {
      encoding.maxBitrate = maxBitrate;
    }
  }

  try {
    await sender.setParameters(params);
  } catch (error) {
    console.error('Failed to set bitrate constraints:', error);
    throw error;
  }
}

