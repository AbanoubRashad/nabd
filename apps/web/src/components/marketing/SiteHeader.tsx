'use client';

/**
 * Marketing header: Products / Solutions / Platform / Resources mega-menus, Developers, the language
 * switch, Sign in and the demo button. Keyboard: Enter or Space opens a menu and focus moves into it; Esc
 * closes it and returns focus to its button; a click outside closes it. Below 1024 px it collapses into a
 * drawer.
 */
import Image from 'next/image';
import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { PRODUCT_CATEGORIES, PRODUCTS, type ProductCategory } from '@nabd/shared';
import { Logo } from '@/components/Logo';
import { Link, usePathname } from '@/i18n/navigation';
import { productText } from '@/lib/catalog';

type Menu = 'products' | 'solutions' | 'platform' | 'resources';
const MENUS: Menu[] = ['products', 'solutions', 'platform', 'resources'];

interface Item {
  name: string;
  text: string;
  href: string;
}

export function SiteHeader({ variant }: { variant: 'overlay' | 'solid' }) {
  const t = useTranslations('header');
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState<Menu | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [category, setCategory] = useState<ProductCategory>('Sensor nodes');
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const triggers = useRef<Partial<Record<Menu, HTMLButtonElement | null>>>({});
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerButton = useRef<HTMLButtonElement>(null);
  const dark = variant === 'overlay';

  // Focus moves into an opened menu; Esc and outside clicks close it.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const trigger = triggers.current[open];
      setOpen(null);
      trigger?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // The drawer behaves like a modal dialog: focus inside, Esc closes, focus returns to the button.
  useEffect(() => {
    if (!drawer) return;
    drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawer(false);
        drawerButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawer]);

  const solutions = t.raw('solutions') as { name: string; uses: string[] }[];
  const tech = t.raw('tech') as Item[];
  const resources = t.raw('resources') as Item[];
  const otherLocale = locale === 'ar' ? 'en' : 'ar';

  const link = dark ? 'text-[#E7EDF3] hover:text-white' : 'text-ink hover:text-green-text';
  const pill = 'inline-flex min-h-11 items-center rounded-control px-3 no-underline';

  return (
    <div ref={root} className={`relative z-20 ${dark ? '' : 'border-b border-line bg-surface'}`}>
      <header className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-4 py-5 sm:px-8 sm:py-6">
        <Link
          href="/"
          className={`flex items-center gap-3 no-underline ${dark ? 'text-[#F2F5F8]' : 'text-ink'}`}
          aria-label={t('home')}
        >
          <Logo className="size-9" />
          <span className="font-display text-[22px]">Nabd</span>
          <span lang="ar" className={`text-[15px] ${dark ? 'text-text-2' : 'text-muted'}`}>
            نبض
          </span>
        </Link>

        <nav aria-label={t('main')} className="hidden items-center gap-1.5 text-[15px] lg:flex">
          {MENUS.map((m) => (
            <button
              key={m}
              ref={(el) => {
                triggers.current[m] = el;
              }}
              type="button"
              aria-expanded={open === m}
              aria-controls={panelId}
              onClick={() => setOpen(open === m ? null : m)}
              className={`${pill} cursor-pointer gap-1.5 border-0 ${link} ${
                open === m ? (dark ? 'bg-white/15' : 'bg-tag-neutral') : 'bg-transparent'
              }`}
            >
              {t(`menus.${m}`)}
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                aria-hidden="true"
                className={open === m ? 'rotate-180' : ''}
              >
                <path
                  d="M2.5 4.5 6 8l3.5-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ))}
          <a href="https://github.com/AbanoubRashad/nabd" className={`${pill} ${link}`}>
            {t('developers')}
          </a>
          <Link
            href={pathname}
            locale={otherLocale}
            lang={otherLocale}
            className={`mx-1.5 rounded-lg border px-2.5 py-1.5 no-underline ${
              dark ? 'border-white/30 text-[#DCE3EA]' : 'border-line text-ink-2'
            }`}
          >
            {otherLocale === 'ar' ? t('arabic') : t('english')}
          </Link>
          <Link href="/fleet" className={`${pill} ${link}`}>
            {t('signIn')}
          </Link>
          <Link
            href="/fleet"
            className="inline-flex min-h-11 items-center rounded-control bg-signal px-5 font-semibold text-on-signal no-underline hover:bg-[#5BE5A8]"
          >
            {t('demo')}
          </Link>
        </nav>

        <button
          ref={drawerButton}
          type="button"
          aria-expanded={drawer}
          aria-controls={`${panelId}-drawer`}
          onClick={() => setDrawer(true)}
          className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-control border lg:hidden ${
            dark ? 'border-white/30 bg-transparent text-white' : 'border-line bg-surface text-ink'
          }`}
        >
          <span className="sr-only">{t('openMenu')}</span>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>

      {open ? (
        <div className="relative mx-auto hidden w-full max-w-[1280px] px-8 lg:block">
          <div
            id={panelId}
            ref={panel}
            className="absolute inset-x-8 top-1 flex flex-wrap gap-7 rounded-[18px] bg-surface p-7 text-ink shadow-[0_30px_80px_rgba(0,0,0,.4)]"
          >
            {open === 'products' ? (
              <>
                <div className="flex min-w-0 flex-[0_1_230px] flex-col gap-1 border-e border-line pe-5">
                  <span className="mb-2 font-mono text-xs tracking-[.08em] text-muted uppercase">
                    {t('menus.products')}
                  </span>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={c === category}
                      onMouseEnter={() => setCategory(c)}
                      onFocus={() => setCategory(c)}
                      onClick={() => setCategory(c)}
                      className={`flex min-h-11 cursor-pointer items-center justify-between rounded-control border-0 px-3 text-start text-[15px] text-ink ${
                        c === category ? 'bg-tag-neutral font-semibold' : 'bg-transparent'
                      }`}
                    >
                      <span>{t(`categories.${c}`)}</span>
                      <span aria-hidden="true" className="text-muted rtl:rotate-180">
                        ›
                      </span>
                    </button>
                  ))}
                  <Link href="/products" className="mt-2.5 px-3 text-sm font-semibold">
                    {t('allProducts')}
                  </Link>
                </div>
                <div className="grid min-w-0 flex-[1_1_560px] grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] content-start gap-3">
                  {PRODUCTS.filter((p) => p.category === category).map((p) => {
                    const text = productText(p, locale);
                    return (
                      <Link
                        key={p.code}
                        href={`/products/${p.code.toLowerCase()}`}
                        className="flex min-h-[72px] items-center gap-3 rounded-xl border border-tag-neutral p-2.5 !text-ink no-underline hover:border-line"
                      >
                        {p.image ? (
                          <Image
                            src={p.image}
                            alt=""
                            width={64}
                            height={64}
                            className="size-16 shrink-0 rounded-lg bg-white object-contain"
                          />
                        ) : (
                          <span className="block size-16 shrink-0 rounded-lg border-[1.5px] border-dashed border-[#B7C1C9] bg-[#F7F9F8]" />
                        )}
                        <span className="flex flex-col gap-0.5">
                          <span className="font-display text-[17px]">
                            {p.code} <span className="font-sans text-[15px] font-semibold">{text.name}</span>
                          </span>
                          <span className="text-[13px] text-muted">{text.line}</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </>
            ) : null}
            {open === 'solutions' ? (
              <div className="grid flex-[1_1_100%] grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-6">
                {solutions.map((s) => (
                  <div key={s.name} className="flex flex-col gap-2">
                    <Link href="/#industries" className="text-base font-bold !text-ink no-underline">
                      {s.name}{' '}
                      <span aria-hidden="true" className="inline-block rtl:rotate-180">
                        ›
                      </span>
                    </Link>
                    {s.uses.map((u) => (
                      <Link
                        key={u}
                        href="/#industries"
                        className="text-sm !text-ink-2 no-underline hover:underline"
                      >
                        {u}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            {open === 'platform' || open === 'resources' ? (
              <div
                className={`grid flex-[1_1_100%] gap-2 ${
                  open === 'platform'
                    ? 'grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))]'
                    : 'grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))]'
                }`}
              >
                {(open === 'platform' ? tech : resources).map((x) => (
                  <MenuLink key={x.name} item={x} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {drawer ? (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t('main')}
          id={`${panelId}-drawer`}
        >
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-hidden="true" />
          <div
            ref={drawerRef}
            className="absolute inset-y-0 end-0 flex w-[min(360px,100%)] flex-col gap-1 overflow-y-auto bg-surface p-5 text-ink"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-xl">Nabd</span>
              <button
                type="button"
                onClick={() => {
                  setDrawer(false);
                  drawerButton.current?.focus();
                }}
                className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-control border border-line bg-surface text-ink"
              >
                <span className="sr-only">{t('closeMenu')}</span>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <DrawerSection title={t('menus.products')}>
              {PRODUCTS.map((p) => (
                <Link
                  key={p.code}
                  href={`/products/${p.code.toLowerCase()}`}
                  className="flex min-h-11 items-center gap-2 !text-ink no-underline"
                  onClick={() => setDrawer(false)}
                >
                  <b className="font-display">{p.code}</b> {productText(p, locale).name}
                </Link>
              ))}
            </DrawerSection>
            <DrawerSection title={t('menus.solutions')}>
              {solutions.map((s) => (
                <Link
                  key={s.name}
                  href="/#industries"
                  className="flex min-h-11 items-center !text-ink no-underline"
                  onClick={() => setDrawer(false)}
                >
                  {s.name}
                </Link>
              ))}
            </DrawerSection>
            <DrawerSection title={t('menus.platform')}>
              {tech.map((x) => (
                <DrawerLink key={x.name} item={x} onClick={() => setDrawer(false)} />
              ))}
            </DrawerSection>
            <DrawerSection title={t('menus.resources')}>
              {resources.map((x) => (
                <DrawerLink key={x.name} item={x} onClick={() => setDrawer(false)} />
              ))}
            </DrawerSection>
            <a
              href="https://github.com/AbanoubRashad/nabd"
              className="flex min-h-11 items-center font-semibold !text-ink no-underline"
            >
              {t('developers')}
            </a>
            <Link
              href={pathname}
              locale={otherLocale}
              lang={otherLocale}
              className="flex min-h-11 items-center !text-ink no-underline"
            >
              {otherLocale === 'ar' ? t('arabic') : t('english')}
            </Link>
            <Link
              href="/fleet"
              className="mt-3 inline-flex min-h-12 items-center justify-center rounded-control bg-signal font-semibold !text-on-signal no-underline"
            >
              {t('demo')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isExternal(href: string) {
  return href.startsWith('http');
}

function MenuLink({ item }: { item: Item }) {
  const className =
    'flex flex-col gap-1 rounded-xl bg-[#F7F9F8] p-3.5 !text-ink no-underline hover:bg-tag-neutral';
  const body = (
    <>
      <b className="text-base">{item.name}</b>
      <span className="text-sm leading-normal text-ink-2">{item.text}</span>
    </>
  );
  return isExternal(item.href) ? (
    <a href={item.href} className={className}>
      {body}
    </a>
  ) : (
    <Link href={item.href} className={className}>
      {body}
    </Link>
  );
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="border-b border-line py-1">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{title}</summary>
      <div className="flex flex-col ps-3 pb-2 text-[15px]">{children}</div>
    </details>
  );
}

function DrawerLink({ item, onClick }: { item: Item; onClick: () => void }) {
  return isExternal(item.href) ? (
    <a href={item.href} className="flex min-h-11 items-center !text-ink no-underline">
      {item.name}
    </a>
  ) : (
    <Link href={item.href} onClick={onClick} className="flex min-h-11 items-center !text-ink no-underline">
      {item.name}
    </Link>
  );
}
