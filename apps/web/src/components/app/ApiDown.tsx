import { useTranslations } from 'next-intl';
import { API_ENABLED, API_SLEEPS } from '@/lib/api';
import { WakeUp } from './WakeUp';

/**
 * Shown instead of live data when the API can't be reached (for example, before the stack is started), or on
 * a website-only deployment that has no backend at all. When the API sleeps on free hosting, the page first
 * says it is waking up and reloads itself once the API answers.
 */
export function ApiDown() {
  const down = <Notice ns={API_ENABLED ? 'app.apiDown' : 'app.backendOffline'} />;
  if (!API_SLEEPS) return down;
  return <WakeUp waking={<Notice ns="app.waking" waking />} fallback={down} />;
}

function Notice({
  ns,
  waking = false,
}: {
  ns: 'app.apiDown' | 'app.backendOffline' | 'app.waking';
  waking?: boolean;
}) {
  const t = useTranslations(ns);
  return (
    <div
      role={waking ? 'status' : 'alert'}
      className={`rounded-card border p-5 text-sm leading-relaxed ${
        waking ? 'border-signal/35 bg-signal/10' : 'border-warning/40 bg-warning/10'
      }`}
    >
      <p className={`flex items-center gap-2 font-semibold ${waking ? 'text-signal' : 'text-warning'}`}>
        {waking && (
          <span aria-hidden="true" className="size-2 rounded-full bg-signal motion-safe:animate-pulse" />
        )}
        {t('title')}
      </p>
      <p className="mt-1 text-text-2">{t('body')}</p>
    </div>
  );
}
