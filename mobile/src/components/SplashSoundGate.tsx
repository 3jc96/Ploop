/**
 * Renders children immediately. Plays ploop sound in background (non-blocking).
 * Improves cold start by ~0.5–2s vs waiting for sound to finish.
 */
import React, { useEffect } from 'react';
import { playPloopSoundIfEnabled } from '../utils/ploopSound';

export function SplashSoundGate({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    playPloopSoundIfEnabled();
  }, []);
  return <>{children}</>;
}
