import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { DeviceDto, FirmwareDto, SiteDto } from '@nabd/shared';
import { ApiDown } from '@/components/app/ApiDown';
import { apiGet } from '@/lib/api';
import { DeviceView } from './DeviceView';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: id };
}

export default async function DevicePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('device');
  if (!/^[a-z0-9-]{1,63}$/.test(id)) notFound();
  const [device, sites, firmware] = await Promise.all([
    apiGet<DeviceDto>(`/devices/${id}`),
    apiGet<SiteDto[]>('/sites'),
    apiGet<FirmwareDto[]>('/firmware'),
  ]);
  if (!sites) {
    return (
      <>
        <h1 className="font-display text-[32px]">{id}</h1>
        <ApiDown />
        <span className="sr-only">{t('fleet')}</span>
      </>
    );
  }
  if (!device) notFound();
  const site = sites.find((s) => s.slug === device.siteSlug)!;
  return <DeviceView device={device} site={site} firmware={firmware ?? []} />;
}
