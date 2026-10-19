import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { AlertDto, DeviceDto, RuleDto } from '@nabd/shared';
import { ApiDown } from '@/components/app/ApiDown';
import { PageHeader } from '@/components/app/ui';
import { apiGet } from '@/lib/api';
import { RuleBuilder } from './RuleBuilder';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'alerts' });
  return { title: t('rulesTitle') };
}

export default async function RulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ rule?: string }>;
}) {
  const { locale } = await params;
  const { rule } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('alerts');
  const [rules, devices, alerts] = await Promise.all([
    apiGet<RuleDto[]>('/alert-rules'),
    apiGet<DeviceDto[]>('/devices'),
    apiGet<AlertDto[]>('/alerts?limit=50'),
  ]);
  if (!rules || !devices) {
    return (
      <>
        <PageHeader title={t('rulesTitle')} />
        <ApiDown />
      </>
    );
  }
  return (
    <RuleBuilder
      rules={rules}
      devices={devices}
      alerts={alerts ?? []}
      initialRuleId={Number(rule) || rules[0]?.id || null}
    />
  );
}
