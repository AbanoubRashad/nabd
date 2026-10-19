import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { DeviceDto, HistoryDto, SiteDto } from '@nabd/shared';
import { ApiDown } from '@/components/app/ApiDown';
import { PageHeader } from '@/components/app/ui';
import { apiGet } from '@/lib/api';
import { SitesView } from './SitesView';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'sites' });
  return { title: t('title') };
}

export default async function SitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ site?: string }>;
}) {
  const { locale } = await params;
  const { site } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('sites');
  const [sites, devices, history] = await Promise.all([
    apiGet<SiteDto[]>('/sites'),
    apiGet<DeviceDto[]>('/devices'),
    apiGet<HistoryDto[]>('/sites/history'),
  ]);
  if (!sites || !devices) {
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <ApiDown />
      </>
    );
  }
  return (
    <SitesView
      sites={sites}
      initialDevices={devices}
      history={history ?? []}
      initialSelected={site ?? 'heliopolis'}
    />
  );
}
