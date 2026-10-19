import Image from 'next/image';
import type { Product } from '@nabd/shared';
import { Link } from '@/i18n/navigation';
import { ctaHref, productText } from '@/lib/catalog';

export const CATEGORY_SLUG: Record<string, string> = {
  'Sensor nodes': 'sensor-nodes',
  Controllers: 'controllers',
  Gateways: 'gateways',
  'Sensor tags': 'sensor-tags',
  Kits: 'kits',
};

export function ProductCard({
  product: p,
  locale,
  labels,
}: {
  product: Product;
  locale: string;
  labels: { prototype: string; planned: string; enclosure: string; category: string };
}) {
  const text = productText(p, locale);
  const proto = p.status === 'Prototype';
  return (
    <article className="flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(11,17,23,.10)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="relative flex h-[220px] items-center justify-center border-b border-tag-neutral bg-white">
        {p.image ? (
          <Image
            src={p.image}
            alt={text.alt}
            width={520}
            height={440}
            sizes="(min-width: 1024px) 320px, 100vw"
            className="h-[220px] w-full object-contain"
          />
        ) : (
          <div className="flex h-[188px] w-[calc(100%-32px)] flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#B7C1C9] bg-[#F7F9F8] text-[13px] text-muted">
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="#5B6875"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="6" width="16" height="12" rx="2.5" />
              <path d="M8 18v2M16 18v2M9 11h6" />
            </svg>
            <span>{labels.enclosure}</span>
          </div>
        )}
        <span
          className={`absolute start-3 top-3 rounded-full border px-2.5 py-1 text-xs font-semibold ${
            proto
              ? 'border-[#BFE8D3] bg-tag-green text-green-text-hover'
              : 'border-[#B7C1C9] bg-white text-ink-2'
          }`}
        >
          {proto ? labels.prototype : labels.planned}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3.5 p-5">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs tracking-[.06em] text-muted uppercase">{labels.category}</span>
          <h3 className="flex items-baseline gap-2.5">
            <span className="font-display text-[26px]">{p.code}</span>
            <span className="text-[17px] font-semibold">{text.name}</span>
          </h3>
        </div>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px] leading-normal text-ink-2">
          {text.specs.map((s) => (
            <li key={s} className="flex gap-2">
              <span aria-hidden="true" className="text-green-text">
                •
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1.5">
          {text.chips.map((c) => (
            <span key={c} className="rounded-full bg-tag-neutral px-2.5 py-1 font-mono text-xs text-ink-2">
              {c}
            </span>
          ))}
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-1">
          <Link href={ctaHref(p)} className="font-semibold">
            {text.cta}{' '}
            <span aria-hidden="true" className="inline-block rtl:rotate-180">
              →
            </span>
          </Link>
          <Link href={`/products/${p.code.toLowerCase()}`} className="text-sm !text-muted">
            {p.code}
          </Link>
        </div>
      </div>
    </article>
  );
}
