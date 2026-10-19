import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { AlertDto } from '@nabd/shared';
import { Sidebar, TabBar } from '@/components/app/Nav';
import { apiGet } from '@/lib/api';

/** The dark app theme: sidebar on desktop, bottom tab bar on phones. */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app');
  const open = await apiGet<AlertDto[]>('/alerts?open=true&limit=200');

  return (
    <div className="flex min-h-dvh bg-ground text-text" data-theme="dark">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-signal focus:px-4 focus:py-2 focus:text-on-signal"
      >
        {t('skip')}
      </a>
      <Sidebar openAlerts={open ? open.length : null} />
      <main id="main" className="flex min-w-0 flex-1 flex-col gap-6 px-4 pt-6 pb-28 sm:px-8 sm:pt-7 md:pb-12">
        {children}
      </main>
      <TabBar />
    </div>
  );
}
