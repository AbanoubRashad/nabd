import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PRODUCTS, type SummaryDto } from '@nabd/shared';
import { ArchitectureDiagram } from '@/components/marketing/ArchitectureDiagram';
import { HeroCard, NumbersStrip } from '@/components/marketing/home/LiveBits';
import { PlatformTabs } from '@/components/marketing/home/PlatformTabs';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { Link } from '@/i18n/navigation';
import { apiGet } from '@/lib/api';
import { productText } from '@/lib/catalog';

const INDUSTRY_IMAGES = [
  '/images/ind-energy.jpg',
  '/images/site-greenhouse.jpg',
  '/images/site-clinic-fridge.jpg',
  '/images/ind-coldchain.jpg',
  '/images/ind-water.jpg',
  '/images/ind-manufacturing.jpg',
];

const eyebrow = 'font-mono text-[13px] tracking-[0.08em] uppercase';
const h2 = 'font-display text-[38px] leading-[1.04] tracking-[-0.015em] sm:text-[48px] lg:text-[56px]';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  // Cached for 10 s and given 1.5 s at most, so a slow or stopped API never holds up the page.
  const summary = await apiGet<SummaryDto>('/fleet/summary', { timeoutMs: 1500, revalidate: 10 });
  const industries = t.raw('industries.items') as {
    title: string;
    body: string;
    units: string;
    alt: string;
  }[];
  const decisions = t.raw('decisions.items') as { title: string; body: string }[];
  const security = t.raw('security.items') as { title: string; body: string }[];
  const featured = ['P1', 'F1', 'R1', 'G1'].map((c) => PRODUCTS.find((p) => p.code === c)!);
  const cs = summary?.caseStudy ?? null;
  const measured = (v: number | null | undefined, unit: string) =>
    v === null || v === undefined ? '[MEASURED]' : `${v.toLocaleString('en-US')}${unit}`;

  return (
    <>
      <section
        aria-label={t('eyebrow')}
        className="relative flex min-h-[780px] flex-col overflow-hidden bg-ground text-[#F2F5F8]"
        data-theme="dark"
      >
        <Image
          src="/images/hero-control-room.jpg"
          alt=""
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          className="object-cover"
          style={{ objectPosition: 'center 40%' }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,9,13,.94)_0%,rgba(6,9,13,.82)_42%,rgba(6,9,13,.35)_75%,rgba(6,9,13,.55)_100%)] rtl:bg-[linear-gradient(270deg,rgba(6,9,13,.94)_0%,rgba(6,9,13,.82)_42%,rgba(6,9,13,.35)_75%,rgba(6,9,13,.55)_100%)]"
        />
        <SiteHeader variant="overlay" />
        <div className="relative mx-auto flex w-full max-w-[1280px] flex-1 flex-wrap items-center gap-12 px-4 pt-12 pb-20 sm:px-8 sm:pt-[72px] sm:pb-[88px]">
          <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-7">
            <span className="inline-flex items-center gap-2.5 self-start rounded-full border border-white/22 bg-[rgba(10,14,19,.5)] px-3.5 py-2 font-mono text-[13px] tracking-[0.06em] text-[#C5D0DC] uppercase">
              <span className="live-dot inline-block size-2 rounded-full bg-signal" aria-hidden="true" />
              {t('eyebrow')}
            </span>
            <h1 className="font-display text-[56px] leading-[0.95] tracking-[-0.025em] text-balance [font-stretch:118%] sm:text-[76px] lg:text-[92px]">
              {t('title')}
            </h1>
            <p className="max-w-[580px] text-lg leading-[1.55] text-pretty text-[#D3DCE5] sm:text-[21px]">
              {t('lead')}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/fleet"
                className="inline-flex min-h-[52px] items-center rounded-xl bg-signal px-[26px] text-[17px] font-semibold !text-on-signal no-underline hover:bg-[#5BE5A8]"
              >
                {t('ctaFleet')}
              </Link>
              <a
                href="#platform"
                className="inline-flex min-h-[52px] items-center rounded-xl border border-white/35 bg-[rgba(10,14,19,.35)] px-[26px] text-[17px] font-medium !text-[#F2F5F8] no-underline"
              >
                {t('ctaHow')}
              </a>
            </div>
          </div>
          <HeroCard initial={summary} />
        </div>
      </section>

      <NumbersStrip initial={summary} />

      <section
        id="industries"
        aria-labelledby="ind-h"
        className="mx-auto flex max-w-[1280px] flex-col gap-10 px-4 py-20 sm:px-8 lg:pt-28 lg:pb-24"
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex max-w-[720px] flex-col gap-3.5">
            <span className={`${eyebrow} text-green-text`}>{t('industries.eyebrow')}</span>
            <h2 id="ind-h" className={h2}>
              {t('industries.title')}
            </h2>
          </div>
          <p className="max-w-[400px] text-[17px] leading-relaxed text-ink-2">{t('industries.lead')}</p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-5">
          {industries.map((ind, i) => (
            <article
              key={ind.title}
              className="group flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface"
            >
              <div className="h-[220px] overflow-hidden">
                <Image
                  src={INDUSTRY_IMAGES[i]!}
                  alt={ind.alt}
                  width={720}
                  height={440}
                  sizes="(min-width: 1280px) 400px, (min-width: 768px) 50vw, 100vw"
                  className="block h-[220px] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none"
                />
              </div>
              <div className="flex flex-col gap-2.5 p-[22px]">
                <div className="flex items-center justify-between gap-2.5">
                  <h3 className="font-display text-[22px] [font-stretch:100%]">{ind.title}</h3>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                      i < 4 ? 'bg-tag-green text-green-text' : 'bg-tag-neutral text-ink-2'
                    }`}
                  >
                    {i < 4 ? t('industries.live') : t('industries.same')}
                  </span>
                </div>
                <p className="text-[15px] leading-relaxed text-ink-2">{ind.body}</p>
                <span className="font-mono text-[13px] text-muted" dir="ltr">
                  {ind.units}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="platform" aria-labelledby="pl-h" className="bg-ground text-text" data-theme="dark">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-11 px-4 py-20 sm:px-8 lg:py-28">
          <div className="flex max-w-[760px] flex-col gap-3.5">
            <span className={`${eyebrow} text-signal`}>{t('platform.eyebrow')}</span>
            <h2 id="pl-h" className={h2}>
              {t('platform.title')}
            </h2>
          </div>
          <PlatformTabs />
        </div>
      </section>

      <section
        id="hardware"
        aria-labelledby="hw-h"
        className="mx-auto flex max-w-[1280px] flex-col gap-9 px-4 py-20 sm:px-8 lg:py-28"
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex max-w-[720px] flex-col gap-3.5">
            <span className={`${eyebrow} text-green-text`}>{t('products.eyebrow')}</span>
            <h2 id="hw-h" className={h2}>
              {t('products.title')}
            </h2>
          </div>
          <Link href="/products" className="text-base font-semibold">
            {t('products.all')}
          </Link>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(270px,100%),1fr))] gap-[18px]">
          {featured.map((p) => {
            const text = productText(p, locale);
            const proto = p.status === 'Prototype';
            return (
              <Link
                key={p.code}
                href={`/products/${p.code.toLowerCase()}`}
                className="flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface !text-ink no-underline transition-shadow hover:shadow-[0_18px_40px_rgba(11,17,23,.10)]"
              >
                <Image
                  src={p.image!}
                  alt={text.alt}
                  width={540}
                  height={420}
                  sizes="(min-width: 1280px) 300px, (min-width: 768px) 50vw, 100vw"
                  className="block h-[210px] w-full border-b border-tag-neutral bg-white object-contain"
                />
                <span className="flex flex-col gap-1.5 px-5 pt-[18px] pb-5">
                  <span className="flex items-baseline gap-2.5">
                    <span className="font-display text-[28px]">{p.code}</span>
                    <span className="text-[17px] font-semibold">{text.name}</span>
                  </span>
                  <span className="text-[15px] leading-normal text-ink-2">{text.line}</span>
                  <span
                    className={`mt-1.5 self-start rounded-full px-2.5 py-1 text-xs font-semibold ${
                      proto ? 'bg-tag-green text-green-text-hover' : 'bg-tag-neutral text-ink-2'
                    }`}
                  >
                    {proto
                      ? locale === 'ar'
                        ? 'نموذج أولي'
                        : 'Prototype'
                      : locale === 'ar'
                        ? 'مخطط'
                        : 'Planned'}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="dec-h" className="border-y border-line bg-surface">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-11 px-4 py-20 sm:px-8 lg:py-28">
          <div className="flex max-w-[760px] flex-col gap-3.5">
            <span className={`${eyebrow} text-green-text`}>{t('decisions.eyebrow')}</span>
            <h2 id="dec-h" className="font-display text-[36px] leading-[1.04] sm:text-[48px]">
              {t('decisions.title')}
            </h2>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] border-t border-line">
            {decisions.map((d, i) => (
              <div key={d.title} className="flex flex-col gap-2.5 border-b border-line py-7 pe-7">
                <span className="font-mono text-sm text-green-text">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="font-display text-[22px] [font-stretch:100%]">{d.title}</h3>
                <p className="text-[15px] leading-relaxed text-ink-2">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="security"
        aria-labelledby="sec-h"
        className="mx-auto flex max-w-[1280px] flex-wrap gap-12 px-4 py-20 sm:px-8 lg:py-28"
      >
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
          <span className={`${eyebrow} text-green-text`}>{t('security.eyebrow')}</span>
          <h2 id="sec-h" className="font-display text-[36px] leading-[1.04] sm:text-[48px]">
            {t('security.title')}
          </h2>
          <p className="text-[17px] leading-relaxed text-ink-2">{t('security.lead')}</p>
        </div>
        <ul className="m-0 grid min-w-0 flex-[1_1_560px] list-none grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-3.5 p-0">
          {security.map((s) => (
            <li
              key={s.title}
              className="flex flex-col gap-2 rounded-card border border-line bg-surface p-[22px]"
            >
              <b className="text-[17px]">{s.title}</b>
              <span className="text-[15px] leading-normal text-ink-2">{s.body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="architecture"
        aria-labelledby="arch-h"
        className="mx-auto max-w-[1280px] px-4 pb-20 sm:px-8 lg:pb-28"
      >
        <div className="flex flex-col gap-6 rounded-[26px] bg-ground p-6 text-text sm:p-10" data-theme="dark">
          <div className="flex flex-col gap-3">
            <span className={`${eyebrow} text-signal`}>{t('architecture.eyebrow')}</span>
            <h2 id="arch-h" className="font-display text-[30px] leading-tight sm:text-[40px]">
              {t('architecture.title')}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <ArchitectureDiagram label={t('architecture.label')} />
            </div>
          </div>
        </div>
      </section>

      <section
        id="case"
        aria-labelledby="case-h"
        className="mx-auto max-w-[1280px] px-4 pb-20 sm:px-8 lg:pb-28"
      >
        <div className="flex flex-wrap overflow-hidden rounded-[26px] bg-ground text-text" data-theme="dark">
          <div className="relative min-h-[300px] min-w-0 flex-[1_1_480px] sm:min-h-[360px]">
            <Image
              src="/images/site-solar-villa.jpg"
              alt={t('case.alt')}
              fill
              sizes="(min-width: 1024px) 640px, 100vw"
              className="object-cover"
            />
          </div>
          <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-[18px] p-6 sm:p-12">
            <span className={`${eyebrow} text-signal`}>{t('case.eyebrow')}</span>
            <h2
              id="case-h"
              className="font-display text-[32px] leading-[1.08] [font-stretch:110%] sm:text-[40px]"
            >
              {t('case.title')}
            </h2>
            <p className="text-[17px] leading-relaxed text-text-2">{t('case.body')}</p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-3">
              {[
                [measured(cs?.uptimePct30d, ' %'), t('case.uptime')],
                [measured(cs?.replayedReadings, ''), t('case.replayed')],
                [measured(cs?.latencyP95Ms, ' ms'), t('case.latency')],
              ].map(([value, label]) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 rounded-[14px] border border-line-3 bg-raised p-4"
                >
                  <span
                    className={`font-mono text-xl ${value === '[MEASURED]' ? 'text-warning' : 'text-text'}`}
                    dir="ltr"
                  >
                    {value}
                  </span>
                  <span className="text-[13px] text-text-2">{label}</span>
                </div>
              ))}
            </div>
            {!cs ? <p className="text-[13px] text-text-muted">{t('case.pending')}</p> : null}
            <Link href="/devices/nabd-01" className="self-start text-base font-semibold">
              {t('case.open')}
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-signal text-on-signal">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-7 px-4 py-[72px] sm:px-8">
          <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-2.5">
            <span className="font-display text-[40px] leading-none [font-stretch:115%] sm:text-[52px]">
              {t('cta.title')}
            </span>
            <span className="text-lg text-[#0D3B27]">{t('cta.body')}</span>
          </div>
          <Link
            href="/fleet"
            className="inline-flex min-h-14 items-center rounded-xl bg-[#06130D] px-[30px] text-[17px] font-semibold !text-[#F2F5F8] no-underline"
          >
            {t('cta.button')}
          </Link>
        </div>
      </section>
    </>
  );
}
