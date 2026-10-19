import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { FirmwareDto } from '@nabd/shared';
import { ApiDown } from '@/components/app/ApiDown';
import { PageHeader, panelClass } from '@/components/app/ui';
import { apiGet } from '@/lib/api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'firmware' });
  return { title: t('title') };
}

export default async function FirmwarePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('firmware');
  const releases = await apiGet<FirmwareDto[]>('/firmware');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {!releases ? (
        <ApiDown />
      ) : releases.length === 0 ? (
        <p className="text-sm text-text-muted">{t('none')}</p>
      ) : (
        <section className={`overflow-x-auto ${panelClass}`}>
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-[13px] text-text-muted">
                {(['version', 'sha', 'date', 'notes'] as const).map((c) => (
                  <th key={c} scope="col" className="px-[22px] py-3 text-start font-medium">
                    {t(`cols.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <tr key={r.version} className="border-t border-line-2">
                  <td className="px-[22px] py-3.5 font-mono">{r.version}</td>
                  <td className="px-[22px] py-3.5 font-mono text-text-2" dir="ltr" title={r.sha256}>
                    {r.sha256.slice(0, 16)}…
                  </td>
                  <td className="px-[22px] py-3.5 text-text-2">
                    {new Date(r.createdAt).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-[22px] py-3.5 text-text-2">{r.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
