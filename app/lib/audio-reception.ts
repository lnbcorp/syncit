/**
 * Audio Reception Utilities
 * Handles receive-only audio configuration for listeners
 */

export interface AudioReceptionConfig {
  playoutDelayHint?: number; // 0.02-0.04s (20-40ms) for low latency
  jitterBufferTarget?: number; // Minimal jitter buffer in ms
  volume?: number; // 0.0 to 1.0
}

const DEFAULT_CONFIG: AudioReceptionConfig = {
  playoutDelayHint: 0.03, // 30ms default
  jitterBufferTarget: 20, // 20ms minimal jitter buffer
  volume: 1.0,
};

/**
 * Configure audio track for low-latency reception
 */
export function configureAudioTrackForReception(
  track: MediaStreamTrack,
  config: AudioReceptionConfig = DEFAULT_CONFIG
): void {
  // Set playoutDelayHint if supported (Chrome/Edge)
  if ('playoutDelayHint' in track && config.playoutDelayHint !== undefined) {
    try {
      (track as any).playoutDelayHint = config.playoutDelayHint;
    } catch (error) {
      console.warn('playoutDelayHint not supported:', error);
    }
  }

  // Configure jitter buffer target if supported
  if ('jitterBufferTarget' in track && config.jitterBufferTarget !== undefined) {
    try {
      (track as any).jitterBufferTarget = config.jitterBufferTarget;
    } catch (error) {
      console.warn('jitterBufferTarget not supported:', error);
    }
  }
}

/**
 * Create audio element for playback
 */
export function createAudioElement(
  stream: MediaStream,
  config: AudioReceptionConfig = DEFAULT_CONFIG
): HTMLAudioElement {
  const audio = new Audio();
  audio.srcObject = stream;
  audio.volume = config.volume ?? 1.0;
  audio.autoplay = false; // User must enable audio due to autoplay policy

  // Configure for low latency
  // Note: Some browsers may not support these properties
  if ('mozPreservesPitch' in audio) {
    (audio as any).mozPreservesPitch = false;
  }

  return audio;
}

/**
 * Set audio output device (sink)
 */
export async function setAudioSink(
  audioElement: HTMLAudioElement,
  deviceId: string
): Promise<void> {
  if (typeof (audioElement as any).setSinkId === 'function') {
    try {
      await (audioElement as any).setSinkId(deviceId);
    } catch (error) {
      console.error('Failed to set audio sink:', error);
      throw error;
    }
  } else {
    console.warn('setSinkId not supported in this browser');
  }
}

/**
 * Set volume on audio element
 */
export function setAudioVolume(audioElement: HTMLAudioElement, volume: number): void {
  audioElement.volume = Math.max(0, Math.min(1, volume));
}

/**
 * Play audio element (handles autoplay policy)
 */
export async function playAudio(audioElement: HTMLAudioElement): Promise<void> {
  try {
    await audioElement.play();
  } catch (error) {
    if ((error as Error).name === 'NotAllowedError') {
      throw new Error('Autoplay blocked. User interaction required.');
    }
    throw error;
  }
}

/**
 * Pause audio element
 */
export function pauseAudio(audioElement: HTMLAudioElement): void {
  audioElement.pause();
}

/**
 * Stop audio element and cleanup
 */
export function stopAudio(audioElement: HTMLAudioElement): void {
  pauseAudio(audioElement);
  if (audioElement.srcObject) {
    const stream = audioElement.srcObject as MediaStream;
    stream.getTracks().forEach(track => track.stop());
    audioElement.srcObject = null;
  }
}

