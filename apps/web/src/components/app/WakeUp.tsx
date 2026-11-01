'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { PUBLIC_API_URL } from '@/lib/api';

const POLL_MS = 4000;
/** A sleeping free instance wakes in about a minute; after this long, something else is wrong. */
const GIVE_UP_MS = 3 * 60_000;

/**
 * Polls the API's health check while a sleeping demo server boots, then re-renders the page with live
 * data. The page's own request to the API is what wakes the server, so this only waits for it.
 */
export function WakeUp({ waking, fallback }: { waking: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      const ok = await fetch(`${PUBLIC_API_URL}/healthz`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(POLL_MS),
      })
        .then((r) => r.ok)
        .catch(() => false);
      if (stopped) return;
      // Keep polling after a refresh: once the page renders live data, this component unmounts.
      if (ok) router.refresh();
      if (!ok && Date.now() - started > GIVE_UP_MS) setGaveUp(true);
      else timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [router]);

  return gaveUp ? fallback : waking;
}
