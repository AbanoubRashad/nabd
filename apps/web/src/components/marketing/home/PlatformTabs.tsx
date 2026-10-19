'use client';

/**
 * The five Platform tabs (Collect, See, Alert, Control, Update) with the WAI-ARIA tabs pattern: roving
 * tabindex, Left/Right (mirrored in RTL), Home and End, and automatic activation.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { SeriesDto } from '@nabd/shared';
import { apiGet } from '@/lib/api';
import { fixed } from '@/lib/format';

interface Tab {
  id: string;
  label: string;
  title: string;
  body: string;
  points: string[];
}

export function PlatformTabs() {
  const t = useTranslations('home.platform');
  const locale = useLocale();
  const tabs = t.raw('tabs') as Tab[];
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const cur = tabs[active]!;

  function onKey(e: React.KeyboardEvent) {
    const rtl = locale === 'ar';
    const next = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 } as Record<string, number>;
    let i: number | null = null;
    if (e.key in next) i = (active + next[e.key]! + tabs.length) % tabs.length;
    if (e.key === 'Home') i = 0;
    if (e.key === 'End') i = tabs.length - 1;
    if (i === null) return;
    e.preventDefault();
    setActive(i);
    refs.current[i]?.focus();
  }

  return (
    <>
      <div role="tablist" aria-label={t('tabsLabel')} className="flex flex-wrap gap-2" onKeyDown={onKey}>
        {tabs.map((tab, i) => {
          const selected = i === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              className={`inline-flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border px-5 text-base font-semibold ${
                selected
                  ? 'border-signal bg-signal text-on-signal'
                  : 'border-line-3 bg-transparent text-[#DCE3EA] hover:border-text-muted'
              }`}
            >
              <span className="font-mono text-[13px] opacity-80">{String(i + 1).padStart(2, '0')}</span>
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${cur.id}`}
        tabIndex={0}
        className="flex flex-wrap items-stretch gap-8 rounded-[22px] border border-line-1 bg-panel p-6 sm:p-9"
      >
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
          <h3 className="font-display text-[28px] leading-tight [font-stretch:100%] sm:text-[32px]">
            {cur.title}
          </h3>
          <p className="text-[17px] leading-relaxed text-text-2">{cur.body}</p>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {cur.points.map((p) => (
              <li key={p} className="flex gap-3 text-[15px] leading-normal text-[#DCE3EA]">
                <span aria-hidden="true" className="font-bold text-signal rtl:rotate-180">
                  →
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex min-h-[300px] min-w-0 flex-[1_1_460px] flex-col gap-3.5 rounded-card border border-[#1A222D] bg-[#05080C] p-[22px]">
          <Preview id={cur.id} />
        </div>
      </div>
    </>
  );
}

function Preview({ id }: { id: string }) {
  const t = useTranslations('home.platform');
  if (id === 'collect') {
    return (
      <>
        <span className="font-mono text-xs text-text-muted" dir="ltr">
          nabd/v1/fayoum/nabd-04/telemetry · QoS 1
        </span>
        <pre className="m-0 font-mono text-sm leading-[1.7] whitespace-pre-wrap text-[#C5D0DC]" dir="ltr">
          {`{\n  "seq": 48210,\n  "ts": "2026-10-14T11:32:10.412Z",\n  "m": { "air_c": 29.4, "rh": 71 }\n}`}
        </pre>
        <span className="text-sm text-signal">{t('collectNote')}</span>
      </>
    );
  }
  if (id === 'see') return <SeePreview />;
  if (id === 'alert') {
    return (
      <>
        <div className="flex flex-col gap-2.5 rounded-[14px] bg-[#0B141A] p-4" dir="ltr" lang="en">
          <div className="max-w-[92%] self-start rounded-[4px_12px_12px_12px] bg-[#1F2C34] px-3.5 py-3 text-sm leading-relaxed text-[#E9EDEF]">
            <b>Nabd alert · Critical</b>
            <br />
            {t('alertBody')}
            <br />
            Reply 1 to acknowledge.
          </div>
          <div className="self-end rounded-[12px_4px_12px_12px] bg-[#005C4B] px-3.5 py-2.5 text-sm text-[#E9EDEF]">
            1
          </div>
        </div>
        <span className="text-sm text-text-2">{t('alertNote')}</span>
      </>
    );
  }
  if (id === 'control') {
    const steps = t.raw('controlSteps') as string[];
    const ms = ['12 ms', '380 ms', '640 ms'];
    return (
      <>
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t('controlTitle')}</span>
          <span className="font-mono text-signal">ON</span>
        </div>
        <ol className="m-0 flex list-none flex-col gap-3 p-0 text-[15px]">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3">
              <span
                className="inline-flex size-6 items-center justify-center rounded-full bg-signal text-xs text-on-signal"
                aria-hidden="true"
              >
                ✓
              </span>
              {s}
              <span className="ms-auto font-mono text-[13px] text-text-muted" dir="ltr">
                {ms[i]}
              </span>
            </li>
          ))}
        </ol>
        <span className="text-[13px] text-text-muted">{t('controlNote')}</span>
      </>
    );
  }
  const lines = t.raw('updateLines') as string[];
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="font-semibold" dir="ltr">
          {t('updateTitle')}
        </span>
        <span className="font-mono text-[13px] text-text-muted">ECDSA P-256 ✓</span>
      </div>
      <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-text-2">
        {lines.map((l, i) => (
          <li key={l} className={i === lines.length - 1 ? 'text-warning' : ''}>
            <span className="font-mono text-text-muted">{i + 1}.</span> {l}
          </li>
        ))}
      </ol>
    </>
  );
}

/** Real data: the villa's solar input and house load over the last 15 minutes. */
function SeePreview() {
  const t = useTranslations('home.platform');
  const [series, setSeries] = useState<{ pv: SeriesDto | null; load: SeriesDto | null } | null>(null);
  useEffect(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 15 * 60_000);
    const q = (m: string) =>
      apiGet<SeriesDto>(
        `/devices/nabd-01/readings?metric=${m}&from=${from.toISOString()}&to=${to.toISOString()}`,
      );
    void Promise.all([q('pv_w'), q('load_w')]).then(([pv, load]) => setSeries({ pv, load }));
  }, []);

  const line = (s: SeriesDto | null | undefined) => {
    const pts = s?.points ?? [];
    if (pts.length < 2) return '';
    const t0 = Date.parse(pts[0]!.t);
    const span = Math.max(1, Date.parse(pts[pts.length - 1]!.t) - t0);
    return pts
      .map(
        (p) =>
          `${(((Date.parse(p.t) - t0) / span) * 460).toFixed(1)},${(195 - (p.avg / 1000) * 45).toFixed(1)}`,
      )
      .join(' ');
  };
  const last = (s: SeriesDto | null | undefined) => {
    const v = s?.points.at(-1)?.avg;
    return v === undefined ? '—' : fixed(v / 1000, 2);
  };
  return (
    <>
      <span className="text-sm text-text-muted">{t('seeTitle')}</span>
      <svg viewBox="0 0 460 200" width="100%" height="200" role="img" aria-label={t('seeChart')}>
        <line x1="0" y1="50" x2="460" y2="50" stroke="#1E2733" />
        <line x1="0" y1="100" x2="460" y2="100" stroke="#1E2733" />
        <line x1="0" y1="150" x2="460" y2="150" stroke="#1E2733" />
        {series ? (
          <>
            <polyline points={line(series.pv)} fill="none" stroke="#3DDC97" strokeWidth="2.5" />
            <polyline points={line(series.load)} fill="none" stroke="#6CB4FF" strokeWidth="2.5" />
          </>
        ) : null}
      </svg>
      <div className="flex gap-4.5 text-[13px] text-text-2" dir="ltr">
        <span>
          <span className="text-signal">━</span> Solar {last(series?.pv)} kW
        </span>
        <span>
          <span className="text-info">━</span> Load {last(series?.load)} kW
        </span>
      </div>
    </>
  );
}
