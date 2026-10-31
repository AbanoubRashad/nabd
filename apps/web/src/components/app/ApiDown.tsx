import { useTranslations } from 'next-intl';
import { API_ENABLED } from '@/lib/api';

/**
 * Shown instead of live data when the API can't be reached (for example, before the stack is started), or on
 * a website-only deployment that has no backend at all.
 */
export function ApiDown() {
  const t = useTranslations(API_ENABLED ? 'app.apiDown' : 'app.backendOffline');
  return (
    <div
      role="alert"
      className="rounded-card border border-warning/40 bg-warning/10 p-5 text-sm leading-relaxed"
    >
      <p className="font-semibold text-warning">{t('title')}</p>
      <p className="mt-1 text-text-2">{t('body')}</p>
    </div>
  );
}
