import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { DeviceDto, SiteDto } from '@nabd/shared';
import { ApiDown } from '@/components/app/ApiDown';
import { PageHeader, StatusLabel, panelClass, type Tone } from '@/components/app/ui';
import { Link } from '@/i18n/navigation';
import { apiGet } from '@/lib/api';
import { rssi, summary } from '@/lib/format';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app.nav' });
  return { title: t('devices') };
}

const tone = (d: DeviceDto): Tone =>
  d.status === 'offline' ? 'offline' : d.status === 'ok' ? 'ok' : d.status;

export default async function DevicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app');
  const ar = locale === 'ar';
  const [devices, sites] = await Promise.all([apiGet<DeviceDto[]>('/devices'), apiGet<SiteDto[]>('/sites')]);
  if (!devices || !sites) {
    return (
      <>
        <PageHeader title={t('nav.devices')} />
        <ApiDown />
      </>
    );
  }
  return (
    <>
      <PageHeader title={t('nav.devices')} subtitle={`${devices.length} · ${sites.length}`} />
      {sites.map((s) => (
        <section key={s.slug} aria-labelledby={`site-${s.slug}`} className="flex flex-col gap-3">
          <h2 id={`site-${s.slug}`} className="text-[17px] font-semibold">
            {ar ? s.nameAr : `${s.nameEn}, ${s.placeEn}`}
          </h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-3 p-0">
            {devices
              .filter((d) => d.siteSlug === s.slug)
              .map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/devices/${d.id}`}
                    className={`flex flex-col gap-2 p-4 !text-text no-underline hover:border-line-3 ${panelClass}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono">{d.id}</span>
                      <StatusLabel tone={tone(d)}>
                        {t(`status.${d.status === 'ok' ? 'ok' : d.status}`)}
                      </StatusLabel>
                    </span>
                    <span className="text-sm text-text-2">{ar ? d.nameAr : d.nameEn}</span>
                    <span className="flex justify-between font-mono text-[13px] text-text-muted" dir="ltr">
                      <span>{d.online ? summary(d.latest) : 'no data'}</span>
                      <span>{d.online ? rssi(d.rssi) : '—'}</span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}
