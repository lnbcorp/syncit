/**
 * WebRTC Stats Collection Utilities
 * Parses getStats() results to extract relevant metrics
 */

export interface WebRTCMetrics {
  rtt?: number; // Round-trip time in milliseconds
  jitter?: number; // Jitter in milliseconds
  packetsLost?: number; // Number of packets lost
  jitterBufferDelay?: number; // Jitter buffer delay in milliseconds
  jitterBufferEmittedCount?: number; // Number of packets emitted from jitter buffer
  audioLevel?: number; // Audio level (0.0 to 1.0)
  timestamp: number; // Client timestamp when metrics were collected
}

/**
 * Anonymize metrics by removing any identifying information
 * and normalizing values
 */
export function anonymizeMetrics(metrics: WebRTCMetrics): WebRTCMetrics {
  return {
    rtt: metrics.rtt,
    jitter: metrics.jitter,
    packetsLost: metrics.packetsLost,
    jitterBufferDelay: metrics.jitterBufferDelay,
    jitterBufferEmittedCount: metrics.jitterBufferEmittedCount,
    audioLevel: metrics.audioLevel,
    timestamp: metrics.timestamp,
    // No peerId or other identifying info included
  };
}

/**
 * Parse RTCStatsReport to extract WebRTC metrics
 */
export async function parseWebRTCStats(stats: RTCStatsReport): Promise<WebRTCMetrics> {
  const metrics: WebRTCMetrics = {
    timestamp: Date.now(),
  };

  // Iterate through all stats entries
  for (const [id, stat] of stats.entries()) {
    // RTCInboundRtpStreamStats - for receiving audio
    if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
      const inboundRtp = stat as RTCInboundRtpStreamStats;

      // Jitter (in seconds, convert to ms)
      if (inboundRtp.jitter !== undefined) {
        metrics.jitter = inboundRtp.jitter * 1000;
      }

      // Packets lost
      if (inboundRtp.packetsLost !== undefined) {
        metrics.packetsLost = inboundRtp.packetsLost;
      }

      // Jitter buffer delay (in seconds, convert to ms)
      if (inboundRtp.jitterBufferDelay !== undefined) {
        metrics.jitterBufferDelay = inboundRtp.jitterBufferDelay * 1000;
      }

      // Jitter buffer emitted count
      if (inboundRtp.jitterBufferEmittedCount !== undefined) {
        metrics.jitterBufferEmittedCount = inboundRtp.jitterBufferEmittedCount;
      }

      // Audio level (if available)
      if (inboundRtp.audioLevel !== undefined) {
        metrics.audioLevel = inboundRtp.audioLevel;
      }
    }

    // RTCOutboundRtpStreamStats - for sending audio
    if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
      const outboundRtp = stat as RTCOutboundRtpStreamStats;

      // Packets lost (for outbound, this is packets lost in transit)
      if (outboundRtp.packetsLost !== undefined && metrics.packetsLost === undefined) {
        metrics.packetsLost = outboundRtp.packetsLost;
      }

      // Audio level (if available)
      if (outboundRtp.audioLevel !== undefined && metrics.audioLevel === undefined) {
        metrics.audioLevel = outboundRtp.audioLevel;
      }
    }

    // RTCIceCandidatePairStats - for RTT
    if (stat.type === 'candidate-pair') {
      const candidatePair = stat as RTCIceCandidatePairStats;

      // Round-trip time (in seconds, convert to ms)
      if (candidatePair.currentRoundTripTime !== undefined) {
        metrics.rtt = candidatePair.currentRoundTripTime * 1000;
      }
    }

    // RTCMediaStreamTrackStats - for audio level (alternative source)
    if (stat.type === 'track' && stat.kind === 'audio') {
      const track = stat as RTCMediaStreamTrackStats;

      // Audio level (if not already set)
      if (track.audioLevel !== undefined && metrics.audioLevel === undefined) {
        metrics.audioLevel = track.audioLevel;
      }
    }
  }

  return metrics;
}

/**
 * Collect metrics from RTCPeerConnection
 */
export async function collectWebRTCMetrics(
  peerConnection: RTCPeerConnection | null
): Promise<WebRTCMetrics | null> {
  if (!peerConnection) {
    return null;
  }

  try {
    const stats = await peerConnection.getStats();
    const metrics = await parseWebRTCStats(stats);
    return anonymizeMetrics(metrics);
  } catch (error) {
    console.error('Failed to collect WebRTC metrics:', error);
    return null;
  }
}

