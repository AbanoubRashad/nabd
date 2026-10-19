import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { AlertDto, RuleDto } from '@nabd/shared';
import { AlertTimeline } from '@/components/app/AlertTimeline';
import { ApiDown } from '@/components/app/ApiDown';
import { PageHeader, StatusLabel, panelClass } from '@/components/app/ui';
import { Link } from '@/i18n/navigation';
import { apiGet } from '@/lib/api';
import { fixed } from '@/lib/format';
import { condition } from '@/lib/rules';
import { AckButton } from '../AckButton';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Alert ${id}` };
}

export default async function AlertPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('alerts');
  if (!/^\d+$/.test(id)) notFound();
  const [alert, rules] = await Promise.all([
    apiGet<AlertDto>(`/alerts/${id}`),
    apiGet<RuleDto[]>('/alert-rules'),
  ]);
  if (!rules) {
    return (
      <>
        <PageHeader title={t('title')} />
        <ApiDown />
      </>
    );
  }
  if (!alert) notFound();
  const rule = rules.find((r) => r.id === alert.ruleId) ?? null;
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6">
      <Link href="/alerts" className="text-sm !text-text-muted">
        ← {t('title')}
      </Link>
      <PageHeader title={alert.ruleName} subtitle={rule ? condition(rule) : undefined}>
        <StatusLabel
          tone={alert.state === 'resolved' ? 'ok' : alert.severity === 'critical' ? 'critical' : 'warning'}
        >
          {t(`states.${alert.state}`)}
        </StatusLabel>
        {alert.state === 'firing' || alert.state === 'muted' ? <AckButton alertId={alert.id} /> : null}
      </PageHeader>
      <section aria-labelledby="tl-h" className={`flex flex-col gap-3.5 p-[22px] ${panelClass}`}>
        <h2 id="tl-h" className="text-[17px] font-semibold">
          {t('timeline')}
        </h2>
        <AlertTimeline alert={alert} rule={rule} />
        {alert.peakValue !== null ? (
          <p className="text-sm text-text-muted">{t('peak', { value: fixed(alert.peakValue, 1) })}</p>
        ) : null}
      </section>
      <Link href={`/devices/${alert.deviceId}`} className="font-mono text-sm">
        {alert.deviceId} →
      </Link>
    </div>
  );
}
