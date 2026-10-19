import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { DeviceDto, FleetEventDto, SiteDto, StatsDto } from '@nabd/shared';
import { ApiDown } from '@/components/app/ApiDown';
import { PageHeader } from '@/components/app/ui';
import { apiGet } from '@/lib/api';
import { FleetView } from './FleetView';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'fleet' });
  return { title: t('title') };
}

export default async function FleetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('fleet');
  const [devices, stats, events, sites] = await Promise.all([
    apiGet<DeviceDto[]>('/devices'),
    apiGet<StatsDto>('/fleet/stats'),
    apiGet<FleetEventDto[]>('/events?limit=6'),
    apiGet<SiteDto[]>('/sites'),
  ]);

  if (!devices || !stats || !sites) {
    return (
      <>
        <PageHeader title={t('title')} />
        <ApiDown />
      </>
    );
  }
  return (
    <FleetView initialDevices={devices} initialStats={stats} initialEvents={events ?? []} sites={sites} />
  );
}
