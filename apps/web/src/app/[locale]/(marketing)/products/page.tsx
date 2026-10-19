import type { Metadata } from 'next';
import Image from 'next/image';
import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { Link } from '@/i18n/navigation';
import { Catalog } from './Catalog';
import { Faq } from './Faq';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'products' });
  return {
    title: t('metaTitle'),
    description: t('lead'),
    alternates: { canonical: locale === 'en' ? '/products' : '/ar/products' },
  };
}

const ICONS = [
  <path key="0" d="M4 12h4l2-5 4 10 2-5h4" />,
  <>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M8 9h8M8 13h5" />
  </>,
  <path key="2" d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />,
  <path key="3" d="M12 4v10M8 10l4 4 4-4M5 19h14" />,
  <>
    <rect x="6" y="3" width="12" height="18" rx="2" />
    <path d="M10 7h4" />
  </>,
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </>,
];

export default async function ProductsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('products');
  const shares = t.raw('shares') as { title: string; body: string }[];
  const faq = t.raw('faq') as { q: string; a: string }[];
  const kit = t.raw('kitPoints') as string[];

  return (
    <>
      <SiteHeader variant="solid" />
      <section className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pt-8 pb-10 sm:px-8">
        <nav aria-label={t('breadcrumb')} className="flex gap-2 text-sm text-muted">
          <Link href="/" className="!text-muted">
            {t('home')}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-ink" aria-current="page">
            {t('metaTitle')}
          </span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex max-w-[760px] flex-col gap-4">
            <h1 className="font-display text-[52px] leading-none [font-stretch:115%] sm:text-[72px]">
              {t('title')}
            </h1>
            <p className="text-lg leading-relaxed text-ink-2">{t('lead')}</p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-green-text" aria-hidden="true" />
              {t('prototypeNote')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full border-2 border-[#B7C1C9]"
                aria-hidden="true"
              />
              {t('plannedNote')}
            </span>
          </div>
        </div>
      </section>

      <Suspense>
        <Catalog />
      </Suspense>

      <section aria-labelledby="kit-h" className="mx-auto max-w-[1280px] px-4 pb-20 sm:px-8">
        <div className="flex flex-wrap overflow-hidden rounded-[26px] bg-ground text-text" data-theme="dark">
          <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-[18px] p-6 sm:p-12">
            <span className="font-mono text-[13px] tracking-[.08em] text-signal uppercase">
              {t('kitEyebrow')}
            </span>
            <h2 id="kit-h" className="font-display text-[30px] leading-tight sm:text-[40px]">
              {t('kitTitle')}
            </h2>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-2.5 p-0 text-[15px] text-[#DCE3EA]">
              {kit.map((k) => (
                <li key={k}>
                  <span aria-hidden="true" className="inline-block text-signal rtl:rotate-180">
                    →
                  </span>{' '}
                  {k}
                </li>
              ))}
            </ul>
            <a
              href="https://github.com/AbanoubRashad/nabd/blob/main/docs/hardware/BOM.md"
              className="inline-flex min-h-12 items-center self-start rounded-xl bg-signal px-6 font-semibold !text-on-signal no-underline"
            >
              {t('kitCta')}
            </a>
          </div>
          <div className="relative min-h-[300px] min-w-0 flex-[1_1_420px]">
            <Image
              src="/images/hardware-flatlay.jpg"
              alt={t('kitAlt')}
              fill
              sizes="(min-width: 1024px) 560px, 100vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="ft-h" className="border-y border-line bg-surface">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-9 px-4 py-20 sm:px-8">
          <h2 id="ft-h" className="font-display text-[34px] leading-tight sm:text-[44px]">
            {t('sharesTitle')}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-8 gap-y-9">
            {shares.map((s, i) => (
              <div key={s.title} className="flex flex-col gap-2">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="#0B7A55"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {ICONS[i]}
                </svg>
                <b className="text-[17px]">{s.title}</b>
                <span className="text-[15px] leading-relaxed text-ink-2">{s.body}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="faq"
        aria-labelledby="faq-h"
        className="mx-auto flex max-w-[1280px] flex-col gap-8 px-4 py-20 sm:px-8"
      >
        <h2 id="faq-h" className="font-display text-[34px] leading-tight sm:text-[44px]">
          {t('faqTitle')}
        </h2>
        <Faq items={faq} />
      </section>

      <section className="bg-signal text-on-signal">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-6 px-4 py-14 sm:px-8">
          <span className="font-display text-[28px] leading-tight sm:text-[36px]">{t('talk')}</span>
          <a
            href="mailto:abanoub.rashad01@gmail.com"
            className="inline-flex min-h-14 items-center rounded-xl bg-[#06130D] px-[30px] text-[17px] font-semibold !text-[#F2F5F8] no-underline"
          >
            {t('talkCta')}
          </a>
        </div>
      </section>
    </>
  );
}
