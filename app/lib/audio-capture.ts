/**
 * Audio Capture Utilities
 * Handles microphone and system/tab audio capture with proper constraints
 */

export interface AudioConstraints {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
  channelCount?: number;
}

export interface AudioCaptureOptions {
  source: 'mic' | 'system';
  constraints?: AudioConstraints;
}

/**
 * Get microphone audio stream
 */
export async function getMicrophoneStream(
  constraints: AudioConstraints = {}
): Promise<MediaStream> {
  const defaultConstraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: constraints.echoCancellation ?? true,
      noiseSuppression: constraints.noiseSuppression ?? true,
      autoGainControl: constraints.autoGainControl ?? true,
      sampleRate: constraints.sampleRate ?? 48000,
      channelCount: constraints.channelCount ?? 1, // Mono
    },
    video: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(defaultConstraints);
    return stream;
  } catch (error) {
    throw new Error(`Failed to access microphone: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get system/tab audio stream
 * Note: getDisplayMedia has limited constraint support compared to getUserMedia
 * Most browsers only support audio: true/false, not detailed audio constraints
 * Some browsers require video: true even when only capturing audio
 */
export async function getSystemAudioStream(): Promise<MediaStream> {
  // getDisplayMedia requires at least one of audio or video to be true
  // Some browsers don't accept explicit video: false, so we'll request both
  // and then stop the video track after getting the stream
  const constraints: DisplayMediaStreamConstraints = {
    audio: true,
    video: true, // Required by most browsers, we'll stop it after
  };

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    
    // Stop video tracks immediately since we only need audio
    stream.getVideoTracks().forEach(track => {
      track.stop();
      stream.removeTrack(track);
    });
    
    // Check if we have an audio track
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      // Clean up the stream since we can't use it
      stream.getTracks().forEach(track => track.stop());
      
      // Detect macOS for specific instructions
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
      
      // User may have selected a source without audio or cancelled audio selection
      // Provide a helpful error message with platform-specific instructions
      let errorMessage = 'No audio track available. ';
      
      if (isMac) {
        errorMessage += 'On macOS:\n\n' +
          '• Chrome/Edge: Look for "Share audio" checkbox in the sharing dialog\n' +
          '• Safari: Audio sharing may not be available - try Chrome or Edge instead\n' +
          '• Select a tab/window that is currently playing audio\n' +
          '• Make sure the source (tab/app) has audio playing when you select it';
      } else {
        errorMessage += 'When sharing your screen/tab:\n\n' +
          '• Make sure to check the "Share audio" or "Share tab audio" checkbox\n' +
          '• Select a tab/window that is currently playing audio\n' +
          '• Some browsers require you to explicitly enable audio sharing';
      }
      
      throw new Error(errorMessage);
    }
    
    // After getting the stream, we can try to apply constraints to the audio track
    // But note: these may not be supported by all browsers
    const audioTrack = audioTracks[0];
    
    // Check if the audio track is actually enabled and working
    if (!audioTrack.enabled) {
      console.warn('Audio track is disabled, enabling it');
      audioTrack.enabled = true;
    }
    
    try {
      await audioTrack.applyConstraints({
        echoCancellation: false, // Usually disabled for system audio
        noiseSuppression: false,
        autoGainControl: false,
      });
    } catch (constraintError) {
      // Constraints may not be supported, but that's okay
      console.warn('Could not apply audio constraints to system audio track:', constraintError);
    }
    
    return stream;
  } catch (error) {
    // If it's our custom error, throw it as-is
    if (error instanceof Error && error.message.includes('No audio track available')) {
      throw error;
    }
    
    // Otherwise, wrap it in a more user-friendly message
    throw new Error(`Failed to access system audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get audio stream based on source type
 */
export async function getAudioStream(options: AudioCaptureOptions): Promise<MediaStream> {
  if (options.source === 'mic') {
    return getMicrophoneStream(options.constraints);
  } else {
    return getSystemAudioStream();
  }
}

/**
 * Apply audio constraints to an existing track
 */
export async function applyAudioConstraints(
  track: MediaStreamTrack,
  constraints: AudioConstraints
): Promise<void> {
  try {
    await track.applyConstraints({
      echoCancellation: constraints.echoCancellation,
      noiseSuppression: constraints.noiseSuppression,
      autoGainControl: constraints.autoGainControl,
      sampleRate: constraints.sampleRate,
      channelCount: constraints.channelCount,
    });
  } catch (error) {
    console.error('Failed to apply audio constraints:', error);
    throw error;
  }
}

/**
 * Mute/unmute audio track
 */
export function setTrackMuted(track: MediaStreamTrack, muted: boolean): void {
  track.enabled = !muted;
}

/**
 * Check if track is muted
 */
export function isTrackMuted(track: MediaStreamTrack): boolean {
  return !track.enabled;
}

/**
 * Stop all tracks in a stream
 */
export function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach(track => track.stop());
}

/**
 * Get audio track from stream
 */
export function getAudioTrack(stream: MediaStream): MediaStreamTrack | null {
  const audioTracks = stream.getAudioTracks();
  return audioTracks.length > 0 ? audioTracks[0] : null;
}

