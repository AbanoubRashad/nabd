'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SummaryDto } from '@nabd/shared';
import { clock, fixed } from '@/lib/format';
import { useSummary } from './useSummary';

/** The hero's live alert card: the demo medicine fridge, from the API. */
export function HeroCard({ initial }: { initial: SummaryDto | null }) {
  const t = useTranslations('home.card');
  const summary = useSummary(initial);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const fridge = summary?.fridge ?? null;
  const status = fridge?.status ?? 'offline';
  const tone =
    status === 'warning'
      ? { text: 'text-warning', badge: 'border-warning/45 bg-warning/12 text-warning', label: t('warning') }
      : status === 'critical'
        ? {
            text: 'text-critical',
            badge: 'border-critical/45 bg-critical/12 text-critical',
            label: t('critical'),
          }
        : status === 'offline'
          ? {
              text: 'text-text-2',
              badge: 'border-critical/45 bg-critical/12 text-critical',
              label: t('offline'),
            }
          : { text: 'text-signal', badge: 'border-signal/45 bg-signal/12 text-signal', label: t('normal') };

  // Sparkline: the last 30 minutes of the probe, with the 8 °C limit as a dashed line.
  const spark = fridge?.spark ?? [];
  const y = (v: number) => (90 - (v - 2) * 10).toFixed(1);
  const points = spark
    .map((v, i) => `${((i / Math.max(1, spark.length - 1)) * 360).toFixed(1)},${y(v)}`)
    .join(' ');
  const alert = fridge?.alert ?? null;
  const recent = alert && now - Date.parse(alert.openedAt) < 60 * 60_000;

  return (
    <div
      className="ms-auto flex min-w-0 flex-[0_1_400px] flex-col gap-4 rounded-[20px] border border-white/14 bg-[rgba(13,18,24,.78)] p-[22px] shadow-[0_30px_80px_rgba(0,0,0,.45)] backdrop-blur-[14px]"
      aria-live="off"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-text-muted">{t('where')}</span>
          <span className="font-display text-[19px] [font-stretch:100%]">{t('name')}</span>
        </div>
        <span className={`rounded-full border px-2.5 py-1 font-mono text-xs ${tone.badge}`}>
          {tone.label}
        </span>
      </div>
      <div className="flex items-baseline gap-2.5" dir="ltr">
        <span className={`font-mono text-[54px] leading-none font-medium ${tone.text}`}>
          {fridge?.probeC === null || fridge?.probeC === undefined ? '—' : fixed(fridge.probeC, 1)}
        </span>
        <span className="text-xl text-text-2">°C</span>
        <span className="ms-auto text-[13px] text-text-muted" dir="auto">
          <bdi>{t('safe')}</bdi>
        </span>
      </div>
      <svg viewBox="0 0 360 90" width="100%" height="90" role="img" aria-label={t('chart')}>
        <line x1="0" y1={y(8)} x2="360" y2={y(8)} stroke="#F5B13D" strokeDasharray="4 5" strokeWidth="1.5" />
        {points ? <polyline points={points} fill="none" stroke="#F5B13D" strokeWidth="2.5" /> : null}
      </svg>
      <div className="flex flex-col gap-2 border-t border-white/10 pt-3.5 text-sm">
        {recent && alert ? (
          <>
            {alert.notifiedAt ? (
              <Step mark="bg-[#25D366] text-[#052E16]" text={t('sent')} at={alert.notifiedAt} />
            ) : null}
            {alert.acknowledgedAt ? (
              <Step mark="bg-signal text-on-signal" text={t('acked')} at={alert.acknowledgedAt} />
            ) : null}
          </>
        ) : (
          <span className="text-[13px] text-text-muted">{t('waiting')}</span>
        )}
      </div>
    </div>
  );
}

function Step({ mark, text, at }: { mark: string; text: string; at: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`inline-flex size-[22px] items-center justify-center rounded-full text-xs font-bold ${mark}`}
        aria-hidden="true"
      >
        ✓
      </span>
      <span>{text}</span>
      <span className="ms-auto font-mono text-xs text-text-muted" dir="ltr">
        {clock(at)}
      </span>
    </div>
  );
}

/** "Live demo numbers": measured values only, or a note when the API is not running. */
export function NumbersStrip({ initial }: { initial: SummaryDto | null }) {
  const t = useTranslations('home.numbers');
  const summary = useSummary(initial);
  const cell = (value: string, label: string) => (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[30px] font-medium" dir="ltr">
        {value}
      </span>
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
  return (
    <section aria-label={t('label')} className="border-b border-line bg-surface">
      {summary ? (
        <div className="mx-auto grid max-w-[1280px] grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-6 px-4 py-7 sm:px-8">
          {cell(summary.readingsToday.toLocaleString('en-US'), t('rows'))}
          {cell(summary.latencyP95Ms === null ? '—' : `${summary.latencyP95Ms} ms`, t('latency'))}
          {cell(`${summary.devicesOnline} / ${summary.devicesTotal}`, t('online', { sites: summary.sites }))}
          {cell('2 s', t('interval'))}
        </div>
      ) : (
        <p className="mx-auto max-w-[1280px] px-4 py-7 text-sm text-muted sm:px-8">{t('offline')}</p>
      )}
      <div
        className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-7 gap-y-3 px-4 pb-7 font-mono text-sm text-ink-2 sm:px-8"
        dir="ltr"
      >
        <span className="font-sans text-[13px] text-muted">{t('standards')}</span>
        {[
          'MQTT 3.1.1',
          'TLS 1.3',
          'WebSocket',
          'TimescaleDB',
          'ESP32-S3',
          'Signed OTA',
          'WhatsApp Cloud API',
        ].map((s, i) => (
          <span key={s} className="inline-flex gap-7">
            {i > 0 ? (
              <span aria-hidden="true" className="text-[#B7C1C9]">
                /
              </span>
            ) : null}
            <span>{s}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
