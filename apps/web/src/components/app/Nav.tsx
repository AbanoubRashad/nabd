'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { Logo } from '@/components/Logo';

const ITEMS = [
  { href: '/fleet', key: 'overview' },
  { href: '/sites', key: 'sites' },
  { href: '/devices', key: 'devices' },
  { href: '/alerts', key: 'alerts' },
  { href: '/alerts/rules', key: 'rules' },
  { href: '/firmware', key: 'firmware' },
] as const;

function isCurrent(pathname: string, href: string) {
  if (href === '/alerts') return pathname === '/alerts' || /^\/alerts\/\d+/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop sidebar (768 px and up), as on the Fleet and Sites artboards. */
export function Sidebar({ openAlerts }: { openAlerts: number | null }) {
  const t = useTranslations('app');
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-7 border-e border-[#1A222D] bg-deep px-4 py-6 md:flex">
      <Link href="/" className="flex items-center gap-2.5 px-2 text-text no-underline">
        <Logo className="size-[30px]" />
        <span className="font-display text-xl">Nabd</span>
      </Link>
      <nav aria-label={t('nav.label')} className="flex flex-col gap-1 text-[15px]">
        {ITEMS.map((item) => {
          const current = isCurrent(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current ? 'page' : undefined}
              className={`flex min-h-11 items-center justify-between rounded-control px-3 no-underline ${
                current
                  ? 'bg-raised font-semibold text-text'
                  : 'text-text-2 hover:bg-raised/60 hover:text-text'
              }`}
            >
              {t(`nav.${item.key}`)}
              {item.key === 'alerts' && openAlerts ? (
                <span className="rounded-full bg-[#3A2A14] px-2 py-0.5 font-mono text-xs text-warning">
                  {openAlerts}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-1.5 rounded-xl border border-line-1 bg-panel p-3.5 text-[13px]">
        <span className="text-text-muted">{t('demo.title')}</span>
        <span className="leading-normal">{t('demo.body')}</span>
      </div>
    </aside>
  );
}

const TABS = [
  { href: '/fleet', key: 'home', icon: <path d="M3 12h4l2-6 4 12 2-6h6" /> },
  {
    href: '/sites',
    key: 'sites',
    icon: (
      <>
        <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
  },
  {
    href: '/alerts',
    key: 'alerts',
    icon: (
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10 21h4" />
      </>
    ),
  },
  {
    href: '/devices',
    key: 'devices',
    icon: (
      <>
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
      </>
    ),
  },
] as const;

/** Bottom tab bar below 768 px, as on the Arabic mobile artboard. */
export function TabBar() {
  const t = useTranslations('app');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('nav.label')}
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[#1A222D] bg-deep px-2 pt-2 pb-[max(env(safe-area-inset-bottom),12px)] md:hidden"
    >
      {TABS.map((tab) => {
        const current = isCurrent(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={`flex min-h-[52px] flex-col items-center justify-center gap-1 text-xs no-underline ${
              current ? 'font-semibold text-signal' : 'text-text-muted'
            }`}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {tab.icon}
            </svg>
            {t(`nav.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
