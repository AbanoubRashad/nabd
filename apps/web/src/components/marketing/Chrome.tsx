import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function AnnouncementBar() {
  const t = useTranslations('header');
  return (
    <div className="relative z-30 bg-[#06090D] text-sm text-[#DCE3EA]">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2.5 px-4 py-2.5 sm:px-8">
        <span className="rounded bg-signal px-2 py-0.5 text-[11px] font-bold tracking-[.08em] text-on-signal">
          {t('new')}
        </span>
        <span>{t('announce')}</span>
        <Link href="/devices/nabd-01" className="font-semibold !text-signal">
          {t('announceLink')}
        </Link>
      </div>
    </div>
  );
}

const FOOTER_COLUMNS = {
  en: [
    {
      title: 'Products',
      links: [
        ['Sensor nodes', '/products?cat=sensor-nodes'],
        ['Controllers', '/products?cat=controllers'],
        ['Gateways', '/products?cat=gateways'],
        ['Starter kit', '/products/k1'],
      ],
    },
    {
      title: 'Solutions',
      links: [
        ['Solar & energy', '/#industries'],
        ['Agriculture', '/#industries'],
        ['Cold chain', '/#industries'],
        ['Water & pumping', '/#industries'],
      ],
    },
    {
      title: 'Platform',
      links: [
        ['Connectivity', '/#platform'],
        ['Dashboards', '/fleet'],
        ['Alerts', '/alerts/rules'],
        ['Architecture', '/#architecture'],
      ],
    },
    {
      title: 'Developers',
      links: [
        ['GitHub', 'https://github.com/AbanoubRashad/nabd'],
        ['MQTT contract', 'https://github.com/AbanoubRashad/nabd/blob/main/docs/architecture.md'],
        ['API reference', 'https://github.com/AbanoubRashad/nabd/tree/main/docs/api'],
        ['Firmware', 'https://github.com/AbanoubRashad/nabd/tree/main/firmware/nabd-node'],
      ],
    },
  ],
  ar: [
    {
      title: 'المنتجات',
      links: [
        ['عقد الاستشعار', '/products?cat=sensor-nodes'],
        ['وحدات التحكم', '/products?cat=controllers'],
        ['البوابات', '/products?cat=gateways'],
        ['طقم البداية', '/products/k1'],
      ],
    },
    {
      title: 'الحلول',
      links: [
        ['الطاقة الشمسية', '/#industries'],
        ['الزراعة', '/#industries'],
        ['سلسلة التبريد', '/#industries'],
        ['المياه والضخ', '/#industries'],
      ],
    },
    {
      title: 'المنصة',
      links: [
        ['الاتصال', '/#platform'],
        ['اللوحات', '/fleet'],
        ['التنبيهات', '/alerts/rules'],
        ['البنية', '/#architecture'],
      ],
    },
    {
      title: 'المطورون',
      links: [
        ['GitHub', 'https://github.com/AbanoubRashad/nabd'],
        ['عقد MQTT', 'https://github.com/AbanoubRashad/nabd/blob/main/docs/architecture.md'],
        ['مرجع الواجهة', 'https://github.com/AbanoubRashad/nabd/tree/main/docs/api'],
        ['البرامج الثابتة', 'https://github.com/AbanoubRashad/nabd/tree/main/firmware/nabd-node'],
      ],
    },
  ],
} as const;

export function SiteFooter({ locale }: { locale: string }) {
  const t = useTranslations('footer');
  const columns = FOOTER_COLUMNS[locale === 'ar' ? 'ar' : 'en'];
  return (
    <footer className="bg-ground text-text-2" data-theme="dark">
      <div className="mx-auto grid max-w-[1280px] grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-8 px-4 pt-12 pb-8 sm:px-8">
        {columns.map((col) => (
          <div key={col.title} className="flex flex-col gap-2.5 text-sm">
            <b className="text-text">{col.title}</b>
            {col.links.map(([label, href]) =>
              href.startsWith('http') ? (
                <a key={label} href={href} className="!text-text-2 no-underline hover:!text-text">
                  {label}
                </a>
              ) : (
                <Link key={label} href={href} className="!text-text-2 no-underline hover:!text-text">
                  {label}
                </Link>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-5 border-t border-line-2 px-4 py-8 text-sm sm:px-8">
        <div className="flex flex-col gap-1.5">
          <span className="text-text">{t('built')}</span>
          <span className="text-text-muted">{t('disclosure')}</span>
        </div>
        <div className="flex flex-wrap gap-5">
          <a href="https://abanoub--rashad.web.app">{t('portfolio')}</a>
          <a href="https://github.com/AbanoubRashad">{t('github')}</a>
          <Link href="/#architecture">{t('architecture')}</Link>
        </div>
      </div>
    </footer>
  );
}
