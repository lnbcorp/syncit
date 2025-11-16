import Link from 'next/link';
import CreateRoomButton from './components/CreateRoomButton';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        {/* Title */}
        <h1 className="text-3xl font-semibold text-foreground">PulseCast</h1>
        
        {/* Action Buttons */}
        <nav className="flex w-full flex-col gap-4 sm:flex-row sm:justify-center" aria-label="Main navigation">
          <CreateRoomButton />
          <Link 
            href="/join"
            className="w-full rounded-lg bg-green-500 px-6 py-3 text-center text-white transition-colors hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 sm:w-auto min-h-[44px] flex items-center justify-center"
            aria-label="Join an existing room"
          >
            Join Room
          </Link>
        </nav>
        
        {/* Footer */}
        <footer className="mt-auto w-full text-center text-sm text-foreground/70">
          <p>Works best on headphones • Allow microphone/screen audio to broadcast</p>
        </footer>
      </div>
    </div>
  );
}
