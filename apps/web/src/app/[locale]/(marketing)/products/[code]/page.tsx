import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PRODUCTS, getProduct } from '@nabd/shared';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { LIVE_DEVICE, ctaHref, productText } from '@/lib/catalog';

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => PRODUCTS.map((p) => ({ locale, code: p.code.toLowerCase() })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}): Promise<Metadata> {
  const { locale, code } = await params;
  const p = getProduct(code);
  if (!p) return {};
  const text = productText(p, locale);
  return {
    title: `${p.code} ${text.name}`,
    description: `${text.line}. ${text.specs.join('. ')}.`,
    alternates: { canonical: `${locale === 'en' ? '' : '/ar'}/products/${code}` },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const p = getProduct(code);
  if (!p) notFound();
  const t = await getTranslations('products');
  const th = await getTranslations('header.categories');
  const text = productText(p, locale);
  const proto = p.status === 'Prototype';
  const live = LIVE_DEVICE[p.code];

  return (
    <>
      <SiteHeader variant="solid" />
      <article className="mx-auto flex max-w-[1280px] flex-col gap-8 px-4 py-10 sm:px-8 lg:py-14">
        <Link href="/products" className="text-sm !text-muted">
          {t('detail.back')}
        </Link>
        <div className="flex flex-wrap gap-10">
          <div className="relative flex min-h-[340px] min-w-0 flex-[1_1_440px] items-center justify-center overflow-hidden rounded-[22px] border border-line bg-white">
            {p.image ? (
              <Image
                src={p.image}
                alt={text.alt}
                width={720}
                height={600}
                priority
                sizes="(min-width: 1024px) 560px, 100vw"
                className="h-full max-h-[480px] w-full object-contain"
              />
            ) : (
              <div className="flex h-[300px] w-[calc(100%-48px)] flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#B7C1C9] bg-[#F7F9F8] text-muted">
                {t('enclosure')}
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-5">
            <span className="font-mono text-xs tracking-[.06em] text-muted uppercase">{th(p.category)}</span>
            <h1 className="flex flex-wrap items-baseline gap-3">
              <span className="font-display text-[56px] leading-none">{p.code}</span>
              <span className="text-[28px] font-semibold">{text.name}</span>
            </h1>
            <p className="text-lg text-ink-2">{text.line}</p>
            <p
              className={`rounded-xl border px-4 py-3 text-[15px] ${
                proto
                  ? 'border-[#BFE8D3] bg-tag-green text-green-text-hover'
                  : 'border-[#B7C1C9] bg-tag-neutral text-ink-2'
              }`}
            >
              {proto ? t('detail.prototypeNote') : t('detail.plannedNote')}
            </p>
            <h2 className="text-lg font-semibold">{t('detail.specs')}</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-base text-ink-2">
              {text.specs.map((s) => (
                <li key={s} className="flex gap-2">
                  <span aria-hidden="true" className="text-green-text">
                    •
                  </span>
                  {s}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1.5">
              {text.chips.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-tag-neutral px-2.5 py-1 font-mono text-xs text-ink-2"
                >
                  {c}
                </span>
              ))}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
              <dt className="text-muted">{t('detail.profile')}</dt>
              <dd className="font-mono">{p.profile ?? t('detail.none')}</dd>
              {live ? (
                <>
                  <dt className="text-muted">{t('detail.live')}</dt>
                  <dd>
                    <Link href={`/devices/${live}`} className="font-mono">
                      {live}
                    </Link>
                  </dd>
                </>
              ) : null}
            </dl>
            <div className="flex flex-wrap gap-3">
              <Link
                href={ctaHref(p)}
                className="inline-flex min-h-12 items-center rounded-xl bg-signal px-6 font-semibold !text-on-signal no-underline"
              >
                {text.cta}
              </Link>
              {live ? (
                <Link
                  href={`/devices/${live}`}
                  className="inline-flex min-h-12 items-center rounded-xl border border-line px-6 font-semibold !text-ink no-underline"
                >
                  {t('detail.liveCta', { id: live })}
                </Link>
              ) : null}
            </div>
            {p.image ? <p className="text-[13px] text-muted">{t('detail.renderNote')}</p> : null}
          </div>
        </div>
      </article>
    </>
  );
}
