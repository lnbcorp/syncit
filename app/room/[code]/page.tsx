'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { RoomFullError } from '@/app/components/ErrorStates';

// Lazy-load WebRTC components to reduce initial bundle size
// These components are only loaded when the room page is accessed
const HostDashboard = dynamic(() => import('@/app/components/HostDashboard'), {
  loading: () => (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-foreground">Loading...</div>
    </div>
  ),
  ssr: false, // WebRTC components require client-side only
});

const ListenerView = dynamic(() => import('@/app/components/ListenerView'), {
  loading: () => (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-foreground">Loading...</div>
    </div>
  ),
  ssr: false, // WebRTC components require client-side only
});

interface RoomData {
  code: string;
  listenerCount: number;
  latency?: number;
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<'notfound' | 'full' | null>(null);
  const [role, setRole] = useState<'host' | 'listener' | null>(null);

  useEffect(() => {
    const fetchRoomData = async () => {
      try {
        setIsLoading(true);
        const cleanCode = code.replace(/-/g, '');

        // Get role from sessionStorage (set during join/create)
        const storedRole = sessionStorage.getItem('roomRole') as 'host' | 'listener' | null;
        const storedCode = sessionStorage.getItem('roomCode');

        // If we have stored data and code matches, use it
        if (storedRole && storedCode === cleanCode) {
          setRole(storedRole);
          setRoomData({
            code: cleanCode,
            listenerCount: 0, // TODO: Get from WebSocket/API
          });
        } else {
          // If no stored role, check if this is a new room creation
          // For now, default to host if no role is stored
          setRole('host');
          setRoomData({
            code: cleanCode,
            listenerCount: 0,
          });
        }

        setIsLoading(false);
      } catch (err) {
        setError('Failed to load room');
        setIsLoading(false);
      }
    };

    if (code) {
      fetchRoomData();
    }
  }, [code]);

  const handleStartBroadcast = () => {
    // TODO: Implement WebRTC broadcast start
    console.log('Starting broadcast...');
  };

  const handleEndRoom = () => {
    // TODO: Call API to end room
    if (confirm('Are you sure you want to end this room?')) {
      router.push('/');
    }
  };

  const handleCopyCode = () => {
    // Copy feedback is handled in component
    console.log('Code copied to clipboard');
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-foreground">Loading room...</div>
      </div>
    );
  }

  if (errorType === 'full') {
    return <RoomFullError />;
  }

  if (error || !roomData) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <div className="mb-4 text-red-600 dark:text-red-400">{error || 'Room not found'}</div>
          <button
            onClick={() => router.push('/')}
            className="rounded-lg bg-green-500 px-6 py-2 text-white hover:bg-green-600 min-h-[44px]"
            aria-label="Return to home page"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Wrap WebRTC components in Suspense for lazy loading
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-foreground">Loading room...</div>
        </div>
      }
    >
      {role === 'host' && (
        <div className="flex min-h-screen flex-col items-center justify-center py-8">
          <HostDashboard
            roomCode={roomData.code}
            listenerCount={roomData.listenerCount}
            latency={roomData.latency}
            onStartBroadcast={handleStartBroadcast}
            onEndRoom={handleEndRoom}
            onCopyCode={handleCopyCode}
          />
        </div>
      )}
      {role === 'listener' && (
        <div className="flex min-h-screen flex-col items-center justify-center py-8">
          <ListenerView
            roomCode={roomData.code}
            listenerCount={roomData.listenerCount}
            latency={roomData.latency}
            onLeaveRoom={() => router.push('/')}
            onEnableAudio={() => {
              // TODO: Enable audio playback
              console.log('Audio enabled');
            }}
          />
        </div>
      )}
    </Suspense>
  );
}
