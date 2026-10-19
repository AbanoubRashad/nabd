'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/app/ui';
import { ApiError, apiSend } from '@/lib/api';

/** Acknowledging needs a login (viewer or admin); anonymous demo visitors see why it is disabled. */
export function AckButton({ alertId }: { alertId: string }) {
  const t = useTranslations('alerts');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'login'>('idle');
  async function ack() {
    setState('busy');
    try {
      await apiSend('POST', `/alerts/${alertId}/ack`);
      setState('done');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 401 ? 'login' : 'idle');
    }
  }
  if (state === 'done') return <span className="text-sm text-signal">{t('acked')}</span>;
  if (state === 'login') return <span className="text-sm text-text-muted">{t('loginToAck')}</span>;
  return (
    <Button disabled={state === 'busy'} onClick={() => void ack()}>
      {t('ack')}
    </Button>
  );
}
