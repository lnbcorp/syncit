'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatRoomCode } from '@/app/lib/room-code';

export default function CreateRoomButton() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateRoom = async () => {
    try {
      setIsCreating(true);
      const response = await fetch('/api/room/create', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to create room');
      }

      const data = await response.json();
      
      // Store room code in sessionStorage (role will be set when user joins)
      sessionStorage.setItem('roomCode', data.code);
      
      // Navigate to room page with formatted code
      router.push(`/room/${formatRoomCode(data.code)}`);
    } catch (error) {
      console.error('Error creating room:', error);
      alert('Failed to create room. Please try again.');
      setIsCreating(false);
    }
  };

  return (
    <button
      onClick={handleCreateRoom}
      disabled={isCreating}
      className="w-full rounded-lg bg-green-500 px-6 py-3 text-white hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto min-h-[44px]"
      aria-label={isCreating ? 'Creating room, please wait' : 'Create a new room'}
      aria-busy={isCreating}
    >
      {isCreating ? 'Creating...' : 'Create Room'}
    </button>
  );
}

