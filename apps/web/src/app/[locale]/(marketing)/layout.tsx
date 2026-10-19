import { setRequestLocale } from 'next-intl/server';
import { AnnouncementBar, SiteFooter } from '@/components/marketing/Chrome';

/** Light marketing theme. Each page places its own header (overlaid on the landing hero, solid elsewhere). */
export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="min-h-dvh bg-page text-ink">
      <AnnouncementBar />
      <main id="main">{children}</main>
      <SiteFooter locale={locale} />
    </div>
  );
}
