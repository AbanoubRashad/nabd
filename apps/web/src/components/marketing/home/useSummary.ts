'use client';

import { useEffect, useState } from 'react';
import type { SummaryDto } from '@nabd/shared';
import { apiGet } from '@/lib/api';

/** Landing-page numbers: the server-rendered value first, then refreshed every 10 s while the tab is visible. */
export function useSummary(initial: SummaryDto | null): SummaryDto | null {
  const [summary, setSummary] = useState(initial);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      void apiGet<SummaryDto>('/fleet/summary', { timeoutMs: 2500 }).then((s) => s && setSummary(s));
    };
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, []);
  return summary;
}
