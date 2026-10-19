import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { AlertDto, DeviceDto } from '@nabd/shared';
import { ApiDown } from '@/components/app/ApiDown';
import { PageHeader, StatusLabel, panelClass } from '@/components/app/ui';
import { Link } from '@/i18n/navigation';
import { apiGet } from '@/lib/api';
import { clock, fixed } from '@/lib/format';
import { siteShort } from '@/lib/sites';
import { AckButton } from './AckButton';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'alerts' });
  return { title: t('title') };
}

export default async function AlertsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('alerts');
  const [alerts, devices] = await Promise.all([
    apiGet<AlertDto[]>('/alerts?limit=50'),
    apiGet<DeviceDto[]>('/devices'),
  ]);
  if (!alerts) {
    return (
      <>
        <PageHeader title={t('title')} />
        <ApiDown />
      </>
    );
  }
  const open = alerts.filter((a) => a.state !== 'resolved');
  const recent = alerts.filter((a) => a.state === 'resolved').slice(0, 20);
  const name = (id: string) => {
    const d = devices?.find((x) => x.id === id);
    return d ? (locale === 'ar' ? d.nameAr : d.nameEn) : id;
  };

  const row = (a: AlertDto) => (
    <li key={a.id} className={`flex flex-wrap items-center justify-between gap-3 p-4 ${panelClass}`}>
      <div className="flex flex-col gap-1">
        <Link href={`/alerts/${a.id}`} className="font-semibold">
          {a.ruleName}
        </Link>
        <span className="text-sm text-text-2">
          <span className="font-mono">{a.deviceId}</span> · {name(a.deviceId)},{' '}
          {siteShort(a.siteSlug, locale)} ·{' '}
          <span dir="ltr" className="font-mono">
            {clock(a.openedAt)}
          </span>
          {a.peakValue !== null ? ` · ${t('peak', { value: fixed(a.peakValue, 1) })}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <StatusLabel
          tone={a.state === 'resolved' ? 'ok' : a.severity === 'critical' ? 'critical' : 'warning'}
        >
          {t(`states.${a.state}`)}
        </StatusLabel>
        {a.state === 'firing' || a.state === 'muted' ? <AckButton alertId={a.id} /> : null}
      </div>
    </li>
  );

  return (
    <>
      <PageHeader title={t('title')}>
        <Link href="/alerts/rules" className="text-sm">
          {t('rulesTitle')} →
        </Link>
      </PageHeader>
      <section aria-labelledby="open-h" className="flex flex-col gap-3">
        <h2 id="open-h" className="text-[17px] font-semibold">
          {t('open')} ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="text-sm text-text-muted">{t('none')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">{open.map(row)}</ul>
        )}
      </section>
      {recent.length ? (
        <section aria-labelledby="recent-h" className="flex flex-col gap-3">
          <h2 id="recent-h" className="text-[17px] font-semibold">
            {t('recent')}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">{recent.map(row)}</ul>
        </section>
      ) : null}
    </>
  );
}
