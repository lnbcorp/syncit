'use client';

import { useRouter } from 'next/navigation';

interface ErrorStateProps {
  onRetry?: () => void;
  onGoHome?: () => void;
}

export function InvalidCodeError({ onRetry, onGoHome }: ErrorStateProps) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div className="text-6xl">❌</div>
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">Invalid Room Code</h2>
          <p className="text-foreground/70">
            The room code you entered is invalid or has expired. Please check the code and try again.
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full">
          {onRetry && (
            <button
              onClick={onRetry}
              className="w-full rounded-lg bg-green-500 px-6 py-3 text-white transition-colors hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
              aria-label="Try entering the room code again"
            >
              Try Again
            </button>
          )}
          <button
            onClick={onGoHome || (() => router.push('/'))}
            className="w-full rounded-lg border border-foreground/20 bg-transparent px-6 py-3 text-foreground transition-colors hover:bg-foreground/10 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
            aria-label="Return to home page"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

export function RoomFullError({ onGoHome }: ErrorStateProps) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div className="text-6xl">🚫</div>
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">Room is Full</h2>
          <p className="text-foreground/70">
            This room has reached its maximum capacity of 27 participants. Please try joining another room.
          </p>
        </div>
        <button
          onClick={onGoHome || (() => router.push('/'))}
          className="w-full rounded-lg bg-green-500 px-6 py-3 text-white transition-colors hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
          aria-label="Return to home page"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}

export function NetworkError({ onRetry, onGoHome }: ErrorStateProps) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div className="text-6xl">📡</div>
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">Network Connection Issue</h2>
          <p className="text-foreground/70 mb-2">
            Unable to establish a connection. This may be due to network restrictions or firewall settings.
          </p>
          <p className="text-sm text-foreground/50">
            If you're behind a strict firewall, TURN server fallback may be required.
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full">
          {onRetry && (
            <button
              onClick={onRetry}
              className="w-full rounded-lg bg-green-500 px-6 py-3 text-white transition-colors hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
              aria-label="Retry network connection"
            >
              Retry Connection
            </button>
          )}
          <button
            onClick={onGoHome || (() => router.push('/'))}
            className="w-full rounded-lg border border-foreground/20 bg-transparent px-6 py-3 text-foreground transition-colors hover:bg-foreground/10 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
            aria-label="Return to home page"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

interface AutoplayBlockedProps {
  onEnable: () => void;
  onDismiss?: () => void;
}

export function AutoplayBlockedPrompt({ onEnable, onDismiss }: AutoplayBlockedProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-lg bg-background border border-foreground/20 p-6 shadow-lg">
        <div className="text-center">
          <div className="text-4xl mb-4">🔊</div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Enable Audio Playback</h2>
          <p className="text-foreground/70 mb-6">
            Your browser requires user interaction to play audio. Please click the button below to enable audio playback.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={onEnable}
              className="w-full rounded-lg bg-green-500 px-6 py-3 text-white transition-colors hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
              aria-label="Enable audio playback"
            >
              Enable Audio
            </button>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="w-full rounded-lg border border-foreground/20 bg-transparent px-6 py-3 text-foreground transition-colors hover:bg-foreground/10 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                aria-label="Dismiss audio enable prompt"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

