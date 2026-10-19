'use client';

/** Category and status filters, kept in the URL (?cat=controllers&status=planned) so a view can be shared. */
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PRODUCT_CATEGORIES, PRODUCTS } from '@nabd/shared';
import { CATEGORY_SLUG, ProductCard } from '@/components/marketing/ProductCard';
import { usePathname, useRouter } from '@/i18n/navigation';

const STATUSES = ['all', 'prototype', 'planned'] as const;

export function Catalog() {
  const t = useTranslations('products');
  const th = useTranslations('header.categories');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const cat = params.get('cat') ?? 'all';
  const status = (STATUSES as readonly string[]).includes(params.get('status') ?? '')
    ? params.get('status')!
    : 'all';

  function set(key: 'cat' | 'status', value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === 'all') next.delete(key);
    else next.set(key, value);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  const items = PRODUCTS.filter(
    (p) =>
      (cat === 'all' || CATEGORY_SLUG[p.category] === cat) &&
      (status === 'all' || p.status.toLowerCase() === status),
  );
  const filterButton = (on: boolean, dark: boolean) =>
    `flex min-h-11 w-full cursor-pointer items-center justify-between rounded-control border-0 px-3 text-start text-[15px] ${
      on
        ? dark
          ? 'bg-ground font-semibold text-[#F2F5F8]'
          : 'bg-tag-green font-semibold text-green-text-hover'
        : 'bg-transparent text-ink hover:bg-tag-neutral'
    }`;

  return (
    <section
      aria-label={t('catalogue')}
      className="mx-auto flex max-w-[1280px] flex-wrap items-start gap-8 px-4 pb-20 sm:px-8"
    >
      <aside className="flex min-w-0 flex-[1_1_240px] flex-col gap-7 lg:sticky lg:top-6 lg:max-w-[280px]">
        <div role="group" aria-labelledby="cat-h" className="flex flex-col gap-1">
          <h2 id="cat-h" className="mb-2 font-mono text-xs font-medium tracking-[.08em] text-muted uppercase">
            {t('category')}
          </h2>
          {['all', ...PRODUCT_CATEGORIES].map((c) => {
            const key = c === 'all' ? 'all' : CATEGORY_SLUG[c]!;
            const count = c === 'all' ? PRODUCTS.length : PRODUCTS.filter((p) => p.category === c).length;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={cat === key}
                onClick={() => set('cat', key)}
                className={filterButton(cat === key, true)}
              >
                <span>{c === 'all' ? t('all') : th(c)}</span>
                <span className="font-mono text-[13px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div role="group" aria-labelledby="st-h" className="flex flex-col gap-1">
          <h2 id="st-h" className="mb-2 font-mono text-xs font-medium tracking-[.08em] text-muted uppercase">
            {t('status')}
          </h2>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => set('status', s)}
              className={filterButton(status === s, false)}
            >
              {s === 'all' ? t('anyStatus') : s === 'prototype' ? t('prototype') : t('planned')}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-[18px] text-sm leading-normal text-ink-2">
          <b className="text-ink">{t('elseTitle')}</b>
          <span>{t('elseBody')}</span>
          <a href="https://github.com/AbanoubRashad/nabd/tree/main/docs/hardware" className="font-semibold">
            {t('elseLink')}
          </a>
        </div>
      </aside>
      <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
        <span className="text-sm text-muted" aria-live="polite">
          {t.rich('showing', {
            shown: items.length,
            total: PRODUCTS.length,
            b: (c) => <b className="text-ink">{c}</b>,
          })}
        </span>
        {items.length === 0 ? (
          <p className="text-ink-2">{t('none')}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-[18px]">
            {items.map((p) => (
              <ProductCard
                key={p.code}
                product={p}
                locale={locale}
                labels={{
                  prototype: t('prototype'),
                  planned: t('planned'),
                  enclosure: t('enclosure'),
                  category: th(p.category),
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
