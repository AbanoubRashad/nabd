'use client';

import Image from 'next/image';
import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DeviceDto, HistoryDto, SiteDto } from '@nabd/shared';
import { LivePill } from '@/components/app/LivePill';
import { PageHeader, StatusLabel, TONE_COLOR, TONE_SHAPE, panelClass, type Tone } from '@/components/app/ui';
import { Link } from '@/i18n/navigation';
import { apiGet } from '@/lib/api';
import { fixed, formatMetric, kw, minutesSince } from '@/lib/format';
import { useLive, type LiveEvent } from '@/lib/live';
import { IMAGE_ALT, MAP_PINS, siteShort } from '@/lib/sites';

const COLOR: Record<'ok' | 'warning' | 'critical', string> = {
  ok: '#3DDC97',
  warning: '#F5B13D',
  critical: '#FF7468',
};
const TONE: Record<SiteDto['status'], Tone> = { ok: 'ok', warning: 'warning', critical: 'critical' };

type Value = (dev: (id: string) => DeviceDto | undefined) => string;
const v = (devices: (id: string) => DeviceDto | undefined, id: string, metric: string) =>
  devices(id)?.online ? devices(id)?.latest[metric]?.value : undefined;

/** The four live readings shown for each site, as on the artboard. */
const PANEL: Record<string, { key: string; value: Value; headline?: true }[]> = {
  'wadi-natrun': [
    { key: 'solar', headline: true, value: (d) => `${kw(v(d, 'nabd-01', 'pv_w'))} kW` },
    { key: 'battery', value: (d) => formatMetric('soc', v(d, 'nabd-01', 'soc')) },
    { key: 'bus', value: (d) => formatMetric('bus_v', v(d, 'nabd-01', 'bus_v')) },
    { key: 'load', value: (d) => `${kw(v(d, 'nabd-01', 'load_w'))} kW` },
  ],
  fayoum: [
    { key: 'air', headline: true, value: (d) => formatMetric('air_c', v(d, 'nabd-04', 'air_c')) },
    { key: 'humidity', value: (d) => formatMetric('rh', v(d, 'nabd-04', 'rh')) },
    { key: 'soil', value: (d) => formatMetric('soil_pct', v(d, 'nabd-05', 'soil_pct')) },
    { key: 'pump', value: (d) => formatMetric('relay1', v(d, 'nabd-05', 'relay1')) },
  ],
  heliopolis: [
    { key: 'probe', headline: true, value: (d) => formatMetric('probe_c', v(d, 'nabd-07', 'probe_c')) },
    { key: 'safeRange', value: () => '2–8 °C' },
    {
      key: 'door',
      value: (d) => {
        const door = v(d, 'nabd-07', 'door');
        return door === undefined ? 'no data' : door ? 'Open' : 'Closed';
      },
    },
    { key: 'room', value: (d) => formatMetric('air_c', v(d, 'nabd-08', 'air_c')) },
  ],
  'tenth-of-ramadan': [
    { key: 'room', headline: true, value: (d) => formatMetric('probe_c', v(d, 'nabd-09', 'probe_c')) },
    { key: 'duty', value: (d) => formatMetric('duty_pct', v(d, 'nabd-09', 'duty_pct')) },
    {
      key: 'doorSensor',
      value: (d) => {
        const door = v(d, 'nabd-11', 'door');
        return door === undefined ? 'No data' : door ? 'Open' : 'Closed';
      },
    },
    { key: 'power', value: (d) => `${kw(v(d, 'nabd-10', 'power_w'))} kW` },
  ],
};

export function SitesView({
  sites: initialSites,
  initialDevices,
  history,
  initialSelected,
}: {
  sites: SiteDto[];
  initialDevices: DeviceDto[];
  history: HistoryDto[];
  initialSelected: string;
}) {
  const t = useTranslations('sites');
  const ts = useTranslations('app.status');
  const locale = useLocale();
  const ar = locale === 'ar';
  const [sites, setSites] = useState(initialSites);
  const [devices, setDevices] = useState(initialDevices);
  const [selected, setSelected] = useState(
    sites.some((s) => s.slug === initialSelected) ? initialSelected : 'heliopolis',
  );

  const onEvent = useCallback((e: LiveEvent) => {
    if (e.type === 'reading') {
      setDevices((list) =>
        list.map((d) => {
          if (d.id !== e.deviceId) return d;
          const latest = { ...d.latest };
          for (const [k, val] of Object.entries(e.m))
            if (typeof val === 'number') latest[k] = { value: val, ts: e.ts };
          return { ...d, latest, online: true, lastSeenAt: e.ts };
        }),
      );
    } else if (e.type === 'status') {
      setDevices((list) => list.map((d) => (d.id === e.deviceId ? { ...d, online: e.online } : d)));
    } else if (e.type === 'alert') {
      // A site's pin follows its worst open alert: refetch on every alert change.
      void apiGet<SiteDto[]>('/sites').then((s) => s && setSites(s));
      void apiGet<DeviceDto[]>('/devices').then((d) => d && setDevices(d));
    }
  }, []);
  const state = useLive({ sites: ['*'] }, onEvent);

  const byId = (id: string) => devices.find((d) => d.id === id);
  const site = sites.find((s) => s.slug === selected) ?? sites[0]!;
  const label = (s: SiteDto['status']) => ts(s === 'ok' ? 'normal' : s);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')}>
        <LivePill state={state} />
        <div className="flex flex-wrap gap-3.5 text-[13px] text-text-2">
          {(['ok', 'warning', 'critical'] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={TONE_COLOR[TONE[s]]} aria-hidden="true">
                {TONE_SHAPE[TONE[s]]}
              </span>
              {label(s)}
            </span>
          ))}
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-stretch gap-4">
        <section
          aria-label={t('mapLabel')}
          className="min-w-0 flex-[999_1_560px] rounded-[18px] border border-line-1 bg-deep p-4"
        >
          <div className="relative aspect-[705/465] w-full" dir="ltr">
            <MapBackground />
            {sites.map((s) => {
              const pin = MAP_PINS[s.slug];
              if (!pin) return null;
              const left = `${((pin.x / 705) * 100).toFixed(2)}%`;
              const top = `${((pin.y / 465) * 100).toFixed(2)}%`;
              const on = s.slug === selected;
              const color = COLOR[s.status];
              const size = s.status === 'warning' ? 18 : 14;
              const headline = PANEL[s.slug]?.find((p) => p.headline)?.value(byId) ?? '';
              return (
                <div key={s.slug}>
                  <span
                    aria-hidden="true"
                    className="pin-ring pointer-events-none absolute size-[30px] rounded-full border-2"
                    style={{ left, top, borderColor: color }}
                  />
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={`${siteShort(s.slug, locale)}, ${label(s.status)}, ${headline}`}
                    onClick={() => setSelected(s.slug)}
                    className="absolute flex min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0"
                    style={{ left, top }}
                  >
                    <span
                      className="block"
                      style={{
                        width: size,
                        height: size,
                        background: color,
                        borderRadius: s.status === 'ok' ? '50%' : '2px',
                        clipPath: s.status === 'warning' ? 'polygon(50% 0, 100% 100%, 0 100%)' : 'none',
                        boxShadow: `0 0 0 3px #0A0E13, 0 0 0 ${on ? 6 : 0}px ${color}`,
                      }}
                    />
                  </button>
                  <span
                    className="pointer-events-none absolute -translate-y-1/2 rounded-lg border border-line-3 bg-ground/85 px-2 py-1 text-xs whitespace-nowrap"
                    style={{ left: `calc(${left} + 18px)`, top }}
                  >
                    <b className="font-semibold">{siteShort(s.slug, locale)}</b>{' '}
                    <span className="font-mono" style={{ color }}>
                      {headline}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section
          aria-labelledby="sel-h"
          aria-live="polite"
          className="flex min-w-0 flex-[1_1_340px] flex-col overflow-hidden rounded-[18px] border border-line-1 bg-panel"
        >
          {site.image ? (
            <Image
              src={site.image}
              alt={IMAGE_ALT[site.slug]?.[ar ? 'ar' : 'en'] ?? ''}
              width={680}
              height={380}
              sizes="(min-width: 1024px) 400px, 100vw"
              className="block h-[190px] w-full object-cover"
            />
          ) : null}
          <div className="flex flex-col gap-3.5 p-5">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex flex-col gap-0.5">
                <h2 id="sel-h" className="font-display text-[22px] [font-stretch:100%]">
                  {ar ? site.nameAr : site.nameEn}
                </h2>
                <span className="text-[13px] text-text-muted">{ar ? site.placeAr : site.placeEn}</span>
              </div>
              <span
                className="rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                style={{ color: COLOR[site.status], borderColor: COLOR[site.status] }}
              >
                <span aria-hidden="true">{TONE_SHAPE[TONE[site.status]]} </span>
                {label(site.status)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {(PANEL[site.slug] ?? []).map((m) => (
                <div key={m.key} className="flex flex-col gap-0.5 rounded-xl bg-raised p-3">
                  <span className="text-xs text-text-muted">{t(`metrics.${m.key}` as 'metrics.solar')}</span>
                  <span className="font-mono text-[19px]" dir="ltr">
                    {m.value(byId)}
                  </span>
                </div>
              ))}
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              {site.deviceIds.map((id) => {
                const d = byId(id);
                if (!d) return null;
                const tone: Tone = !d.online ? 'offline' : d.status === 'ok' ? 'ok' : (d.status as Tone);
                const minutes = minutesSince(d.lastSeenAt);
                return (
                  <li key={id} className="flex justify-between gap-2.5">
                    <span>
                      <Link href={`/devices/${id}`} className="font-mono !text-text-2">
                        {id}
                      </Link>{' '}
                      · {ar ? d.nameAr : d.nameEn}
                    </span>
                    <StatusLabel tone={tone}>
                      {!d.online
                        ? `${ts('offline')}${minutes !== null ? ` ${fixed(minutes, 0)} min` : ''}`
                        : ts(d.status === 'ok' ? 'ok' : d.status)}
                    </StatusLabel>
                  </li>
                );
              })}
            </ul>
            <Link href="/devices" className="text-[15px] font-semibold">
              {t('openDevices')}
            </Link>
          </div>
        </section>
      </div>

      <section
        aria-labelledby="up-h"
        className={`flex flex-col gap-3.5 px-[22px] py-5 ${panelClass} rounded-[18px]`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <h2 id="up-h" className="text-[17px] font-semibold">
            {t('history')}
          </h2>
          <span className="text-[13px] text-text-muted">{t('historyNote')}</span>
        </div>
        {history.map((h) => {
          const s = sites.find((x) => x.slug === h.slug);
          return (
            <div key={h.slug} className="flex flex-wrap items-center gap-3">
              <span className="flex-[0_0_200px] text-sm">{s ? (ar ? s.nameAr : s.nameEn) : h.slug}</span>
              <div className="grid min-w-0 flex-[1_1_400px] grid-cols-24 gap-[3px]" dir="ltr">
                {h.hours.map((state, i) => (
                  <span
                    key={i}
                    title={`${t('hoursAgo', { h: 24 - i })} · ${label(state)}`}
                    className="block h-[22px] rounded-[3px]"
                    style={{ background: state === 'ok' ? '#1F6B4C' : COLOR[state] }}
                  >
                    <span className="sr-only">
                      {t('hoursAgo', { h: 24 - i })}: {label(state)}
                    </span>
                  </span>
                ))}
              </div>
              <span className="flex-[0_0_70px] text-end font-mono text-[13px] text-text-2" dir="ltr">
                {h.uptimePct} %
              </span>
            </div>
          );
        })}
      </section>
    </>
  );
}

/** Schematic map of Greater Cairo, the Delta and Fayoum (static SVG from the Sites artboard). */
function MapBackground() {
  return (
    <svg viewBox="0 0 705 465" className="absolute inset-0 block size-full" aria-hidden="true">
      <rect x="0" y="0" width="705" height="465" fill="#0B1A26" />
      <polygon
        points="0,132 67,145 180,108 213,90 235,72 288,52 360,33 442,40 498,42 570,79 615,108 705,99 705,465 0,465"
        fill="#141B23"
        stroke="#2A3646"
        strokeWidth="1.5"
      />
      <polygon
        points="607,274 622,330 645,405 668,465 705,465 705,440 690,420 662,350 638,300 618,272"
        fill="#0B1A26"
        stroke="#2A3646"
        strokeWidth="1.5"
      />
      <polyline
        points="570,79 566,130 565,180 585,217 600,250 607,274"
        fill="none"
        stroke="#1E4D6E"
        strokeWidth="3"
      />
      <ellipse cx="585" cy="217" rx="9" ry="5" fill="#1E4D6E" />
      <polyline
        points="367,465 390,409 405,330 409,262 405,240"
        fill="none"
        stroke="#2A6A94"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <polyline
        points="405,240 375,195 330,135 288,52"
        fill="none"
        stroke="#2A6A94"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <polyline
        points="405,240 412,195 435,127 498,52"
        fill="none"
        stroke="#2A6A94"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <ellipse cx="315" cy="349" rx="30" ry="8" fill="#1E4D6E" />
      <g fontFamily="IBM Plex Sans, sans-serif" fontSize="13" fill="#93A3B5">
        <text x="196" y="118">
          Alexandria
        </text>
        <text x="378" y="292">
          Cairo
        </text>
        <text x="548" y="70">
          Port Said
        </text>
        <text x="620" y="262">
          Suez
        </text>
        <text x="300" y="336">
          Lake Qarun
        </text>
      </g>
      <g fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="#5B6E82" letterSpacing="2">
        <text x="40" y="60">
          MEDITERRANEAN SEA
        </text>
        <text x="70" y="420">
          WESTERN DESERT
        </text>
      </g>
    </svg>
  );
}
