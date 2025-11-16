'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import NumericKeypad from '../components/NumericKeypad';
import { formatRoomCode } from '../lib/room-code';
import { InvalidCodeError, RoomFullError } from '../components/ErrorStates';

type ErrorType = 'invalid' | 'full' | 'network' | null;

export default function JoinPage() {
  const router = useRouter();
  const [isJoining, setIsJoining] = useState(false);
  const [errorType, setErrorType] = useState<ErrorType>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const handleCodeComplete = async (code: string) => {
    try {
      setIsJoining(true);
      setErrorType(null);
      setErrorMessage(null);
      setLastCode(code);

      const response = await fetch('/api/room/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        const data = await response.json();
        const errorMsg = data.error || 'Failed to join room';
        
        // Determine error type based on status and message
        if (response.status === 404 || errorMsg.includes('not found') || errorMsg.includes('expired')) {
          setErrorType('invalid');
        } else if (response.status === 403 || errorMsg.includes('full')) {
          setErrorType('full');
        } else {
          setErrorType('network');
          setErrorMessage(errorMsg);
        }
        setIsJoining(false);
        return;
      }

      const data = await response.json();
      
      // Store token and peerId in sessionStorage for future use
      if (data.token) {
        sessionStorage.setItem('roomToken', data.token);
        sessionStorage.setItem('roomRole', data.role);
        sessionStorage.setItem('roomCode', data.code);
        if (data.peerId) {
          sessionStorage.setItem('peerId', data.peerId);
        }
      }

      // Navigate to room page with formatted code
      router.push(`/room/${formatRoomCode(data.code)}`);
    } catch (err) {
      setErrorType('network');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to join room');
      setIsJoining(false);
    }
  };

  const handleRetry = () => {
    setErrorType(null);
    setErrorMessage(null);
    if (lastCode) {
      handleCodeComplete(lastCode);
    }
  };

  // Show error states
  if (errorType === 'invalid') {
    return <InvalidCodeError onRetry={handleRetry} />;
  }

  if (errorType === 'full') {
    return <RoomFullError />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <h1 className="text-2xl font-semibold text-foreground">Join Room</h1>
        {errorMessage && (
          <div className="w-full rounded-lg bg-red-500/10 border border-red-500/50 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {errorMessage}
          </div>
        )}
        {isJoining ? (
          <div className="text-foreground">Joining room...</div>
        ) : (
          <NumericKeypad onCodeComplete={handleCodeComplete} />
        )}
        <button
          onClick={() => router.back()}
          className="text-sm text-foreground/70 underline hover:text-foreground"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}

