'use client';

import { useTranslations } from 'next-intl';
import type { ConnectionState } from '@/lib/live';

/** "LIVE · WebSocket" while connected; "Reconnecting…" in amber, without the pulse, while it is down. */
export function LivePill({ state }: { state: ConnectionState }) {
  const t = useTranslations('app.live');
  const live = state === 'live';
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 font-mono text-xs ${
        live ? 'border-signal/35 bg-signal/10 text-signal' : 'border-warning/40 bg-warning/10 text-warning'
      }`}
    >
      <span
        className={`inline-block size-1.5 rounded-full ${live ? 'live-dot bg-signal' : 'bg-warning'}`}
        aria-hidden="true"
      />
      {t(state === 'live' ? 'live' : state)}
    </span>
  );
}
