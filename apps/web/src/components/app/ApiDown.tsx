import { useTranslations } from 'next-intl';

/** Shown instead of live data when the API can't be reached (for example, before the stack is started). */
export function ApiDown() {
  const t = useTranslations('app.apiDown');
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
