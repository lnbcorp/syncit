'use client';

import { useState } from 'react';

interface NumericKeypadProps {
  onCodeComplete?: (code: string) => void;
  maxDigits?: number;
}

export default function NumericKeypad({ 
  onCodeComplete, 
  maxDigits = 6 
}: NumericKeypadProps) {
  const [code, setCode] = useState<string>('');

  const handleNumberClick = (num: string) => {
    if (code.length < maxDigits) {
      const newCode = code + num;
      setCode(newCode);
      
      if (newCode.length === maxDigits && onCodeComplete) {
        onCodeComplete(newCode);
      }
    }
  };

  const handleBackspace = () => {
    setCode(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setCode('');
  };

  const formatCode = (code: string): string => {
    if (code.length <= 3) {
      return code;
    }
    return `${code.slice(0, 3)}-${code.slice(3)}`;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key >= '0' && e.key <= '9') {
      handleNumberClick(e.key);
    } else if (e.key === 'Backspace') {
      handleBackspace();
    } else if (e.key === 'Delete' || e.key === 'Escape') {
      handleClear();
    }
  };

  return (
    <div className="w-full max-w-sm" onKeyDown={handleKeyDown} tabIndex={0} role="application" aria-label="Room code keypad">
      {/* Code Display */}
      <div className="mb-6 text-center">
        <label htmlFor="room-code-display" className="mb-2 block text-sm text-foreground/70">
          Enter Room Code
        </label>
        <div 
          id="room-code-display"
          className="flex items-center justify-center gap-2 text-4xl font-mono font-semibold tracking-wider text-foreground"
          role="textbox"
          aria-label={`Room code: ${code || 'empty'}`}
          aria-live="polite"
        >
          {formatCode(code).padEnd(7, '_').split('').map((char, index) => (
            <span 
              key={index}
              className={`inline-block w-10 text-center ${char === '_' ? 'text-foreground/30' : ''}`}
              aria-hidden="true"
            >
              {char}
            </span>
          ))}
        </div>
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            onClick={() => handleNumberClick(num.toString())}
            className="aspect-square rounded-lg bg-foreground/10 text-2xl font-semibold text-foreground transition-colors hover:bg-foreground/20 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 active:bg-foreground/30"
            aria-label={`Number ${num}`}
          >
            {num}
          </button>
        ))}
        
        {/* Clear button */}
        <button
          onClick={handleClear}
          className="aspect-square rounded-lg bg-red-500/10 text-lg font-semibold text-red-600 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 active:bg-red-500/30 dark:text-red-400"
          aria-label="Clear"
        >
          Clear
        </button>
        
        {/* Zero button */}
        <button
          onClick={() => handleNumberClick('0')}
          className="aspect-square rounded-lg bg-foreground/10 text-2xl font-semibold text-foreground transition-colors hover:bg-foreground/20 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 active:bg-foreground/30"
          aria-label="Number 0"
        >
          0
        </button>
        
        {/* Backspace button */}
        <button
          onClick={handleBackspace}
          className="aspect-square rounded-lg bg-foreground/10 text-lg font-semibold text-foreground transition-colors hover:bg-foreground/20 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 active:bg-foreground/30"
          aria-label="Backspace"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}

