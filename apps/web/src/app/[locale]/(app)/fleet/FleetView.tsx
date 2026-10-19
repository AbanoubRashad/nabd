'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DeviceDto, FleetEventDto, RangeKey, SiteDto, StatsDto } from '@nabd/shared';
import { LiveChart, type ChartSeries, type LiveChartHandle } from '@/components/app/LiveChart';
import { LivePill } from '@/components/app/LivePill';
import { Kpi, PageHeader, StatusLabel, inputClass, panelClass, type Tone } from '@/components/app/ui';
import { Link } from '@/i18n/navigation';
import { apiGet } from '@/lib/api';
import { ago, kw, minutesSince, rssi, summary } from '@/lib/format';
import { useLive, type LiveEvent } from '@/lib/live';
import { siteShort } from '@/lib/sites';

const RANGE_KEYS: RangeKey[] = ['15m', '1h', '24h', '7d'];
const POWER_SERIES: ChartSeries[] = [
  { metric: 'pv_w', label: 'Solar', color: '#3DDC97', scale: (w) => w / 1000, fill: true },
  { metric: 'load_w', label: 'Load', color: '#6CB4FF', scale: (w) => w / 1000 },
];

export function deviceTone(d: DeviceDto): Tone {
  return d.status === 'offline'
    ? 'offline'
    : d.status === 'critical'
      ? 'critical'
      : d.status === 'warning'
        ? 'warning'
        : 'ok';
}

export function FleetView({
  initialDevices,
  initialStats,
  initialEvents,
  sites,
}: {
  initialDevices: DeviceDto[];
  initialStats: StatsDto;
  initialEvents: FleetEventDto[];
  sites: SiteDto[];
}) {
  const t = useTranslations('fleet');
  const ts = useTranslations('app.status');
  const locale = useLocale();
  const ar = locale === 'ar';
  const [devices, setDevices] = useState(initialDevices);
  const [stats, setStats] = useState(initialStats);
  const [events, setEvents] = useState(initialEvents);
  const [range, setRange] = useState<RangeKey>('15m');
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [power, setPower] = useState<Record<string, number>>({});
  const chart = useRef<LiveChartHandle>(null);

  const refresh = useCallback(async () => {
    const [s, e] = await Promise.all([
      apiGet<StatsDto>('/fleet/stats'),
      apiGet<FleetEventDto[]>('/events?limit=6'),
    ]);
    if (s) setStats(s);
    if (e) setEvents(e);
  }, []);

  // Stats (rate, latency) are measured at the API: poll them; the clock ticks for "x s ago".
  useEffect(() => {
    const a = setInterval(() => void refresh(), 5000);
    const b = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [refresh]);

  const onEvent = useCallback(
    (e: LiveEvent) => {
      if (e.type === 'reading') {
        if (e.deviceId === 'nabd-01') chart.current?.append(e.ts, e.m);
        setDevices((list) =>
          list.map((d) => {
            if (d.id !== e.deviceId) return d;
            const latest = { ...d.latest };
            for (const [k, v] of Object.entries(e.m))
              if (typeof v === 'number') latest[k] = { value: v, ts: e.ts };
            const lastSeenAt = !d.lastSeenAt || d.lastSeenAt < e.ts ? e.ts : d.lastSeenAt;
            return {
              ...d,
              latest,
              lastSeenAt,
              online: true,
              status: d.status === 'offline' ? 'ok' : d.status,
            };
          }),
        );
      } else if (e.type === 'status') {
        setDevices((list) =>
          list.map((d) =>
            d.id === e.deviceId
              ? {
                  ...d,
                  online: e.online,
                  rssi: e.rssi ?? d.rssi,
                  fwVersion: e.fw ?? d.fwVersion,
                  status: e.online ? (d.status === 'offline' ? 'ok' : d.status) : 'offline',
                }
              : d,
          ),
        );
      } else if (e.type === 'alert' || e.type === 'command') {
        void refresh();
        if (e.type === 'alert') {
          void apiGet<DeviceDto[]>('/devices').then((list) => list && setDevices(list));
        }
      }
    },
    [refresh],
  );
  const state = useLive({ sites: ['*'] }, onEvent);

  const siteName = useCallback((slug: string) => siteShort(slug, locale), [locale]);
  const deviceName = (d: DeviceDto) => (ar ? d.nameAr : d.nameEn);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) =>
      [d.id, d.nameEn, d.nameAr, siteName(d.siteSlug), d.kind, ...Object.keys(d.latest)].some((s) =>
        s.toLowerCase().includes(q),
      ),
    );
  }, [devices, query, siteName]);

  const online = devices.filter((d) => d.online).length;
  const firstOffline = devices.find((d) => !d.online);
  const offlineMinutes = firstOffline ? minutesSince(firstOffline.lastSeenAt, now) : null;
  const newest = devices.reduce<string | null>(
    (m, d) => (d.lastSeenAt && (!m || d.lastSeenAt > m) ? d.lastSeenAt : m),
    null,
  );
  const open = stats.openAlerts.critical + stats.openAlerts.warning;

  const series = useMemo(
    () => POWER_SERIES.map((s) => ({ ...s, label: s.metric === 'pv_w' ? t('solar') : t('load') })),
    [t],
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', {
          sites: sites.length,
          devices: devices.length,
          ago: ago(newest, now, ar ? 'ar' : 'en'),
        })}
      >
        <LivePill state={state} />
        <div
          role="group"
          aria-label={t('range')}
          className="flex gap-1 rounded-control border border-line-1 bg-panel p-1"
        >
          {RANGE_KEYS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => setRange(r)}
              className={`min-h-9 min-w-[52px] cursor-pointer rounded-[7px] border-0 font-mono text-[13px] ${
                r === range ? 'bg-signal text-on-signal' : 'bg-transparent text-text-2 hover:text-text'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4">
        <Kpi
          label={t('online')}
          value={
            <>
              {online}
              <span className="text-xl text-text-muted"> / {devices.length}</span>
            </>
          }
          note={
            firstOffline
              ? t('offlineFor', { id: firstOffline.id, minutes: offlineMinutes ?? 0 })
              : t('allOnline')
          }
          noteTone={firstOffline ? 'critical' : undefined}
        />
        <Kpi label={t('rate')} value={stats.messagesPerSecond.toFixed(1)} note={t('rateNote')} />
        <Kpi
          label={t('openAlerts')}
          value={open}
          tone={open ? 'warning' : undefined}
          accent={open ? 'warning' : undefined}
          note={t('openAlertsNote', {
            critical: stats.openAlerts.critical,
            warning: stats.openAlerts.warning,
          })}
        />
        <Kpi
          label={t('latency')}
          value={stats.latencyP95Ms === null ? '—' : `${stats.latencyP95Ms} ms`}
          tone={stats.latencyP95Ms === null ? undefined : 'ok'}
          note={stats.latencyP95Ms === null ? t('latencyWaiting') : t('latencyNote')}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <section
          aria-labelledby="pw-h"
          className={`flex min-w-0 flex-[999_1_560px] flex-col gap-4 p-[22px] ${panelClass}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 id="pw-h" className="text-[17px] font-semibold">
                {t('power')}
              </h2>
              <span className="text-[13px] text-text-muted">
                {t('powerNote', {
                  range,
                  step:
                    range === '15m' || range === '1h'
                      ? '2 s samples'
                      : range === '24h'
                        ? '1 min roll-up'
                        : '1 h roll-up',
                })}
              </span>
            </div>
            <div className="flex gap-4 text-[13px]">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-[3px] w-3.5 bg-signal" aria-hidden="true" />
                {t('solar')}{' '}
                <span className="font-mono" dir="ltr">
                  {power.pv_w === undefined ? '—' : kw(power.pv_w * 1000)} kW
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-[3px] w-3.5 bg-info" aria-hidden="true" />
                {t('load')}{' '}
                <span className="font-mono" dir="ltr">
                  {power.load_w === undefined ? '—' : kw(power.load_w * 1000)} kW
                </span>
              </span>
            </div>
          </div>
          <LiveChart
            ref={chart}
            deviceId="nabd-01"
            series={series}
            range={range}
            height={240}
            ariaLabel={`${t('power')}: ${t('solar')} / ${t('load')} (kW), ${range}`}
            onLatest={setPower}
          />
        </section>

        <section
          aria-labelledby="ev-h"
          className={`flex min-w-0 flex-[1_1_320px] flex-col gap-3.5 p-[22px] ${panelClass}`}
        >
          <div className="flex items-center justify-between">
            <h2 id="ev-h" className="text-[17px] font-semibold">
              {t('events')}
            </h2>
            <Link href="/alerts" className="text-sm">
              {t('allAlerts')}
            </Link>
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-text-muted">{t('noEvents')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {events.map((e, i) => (
                <EventItem key={`${e.at}-${i}`} event={e} devices={devices} now={now} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="dv-h" className={`flex flex-col ${panelClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-[22px] pt-5 pb-2">
          <h2 id="dv-h" className="text-[17px] font-semibold">
            {t('devices')}
          </h2>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            {t('search')}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className={`w-[220px] ${inputClass} min-h-10`}
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="text-start text-[13px] text-text-muted">
                {(['device', 'site', 'reading', 'signal', 'firmware', 'seen', 'status'] as const).map((c) => (
                  <th key={c} scope="col" className="px-[22px] py-3 text-start font-medium">
                    {t(`columns.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-t border-line-2">
                  <td className="px-[22px] py-3.5">
                    <Link
                      href={`/devices/${d.id}`}
                      className="flex flex-col gap-0.5 !text-text no-underline hover:underline"
                    >
                      <span className="font-mono">{d.id}</span>
                      <span className="text-[13px] text-text-muted">{deviceName(d)}</span>
                    </Link>
                  </td>
                  <td className="px-[22px] py-3.5 text-text-2">{siteName(d.siteSlug)}</td>
                  <td className="px-[22px] py-3.5 font-mono" dir="ltr">
                    {d.online ? summary(d.latest) : 'no data'}
                  </td>
                  <td className="px-[22px] py-3.5 font-mono text-text-2" dir="ltr">
                    {d.online ? rssi(d.rssi) : '—'}
                  </td>
                  <td className="px-[22px] py-3.5 font-mono text-text-2">{d.fwVersion ?? '—'}</td>
                  <td className="px-[22px] py-3.5 text-text-2">{ago(d.lastSeenAt, now, ar ? 'ar' : 'en')}</td>
                  <td className="px-[22px] py-3.5">
                    <StatusLabel tone={deviceTone(d)}>{ts(d.status === 'ok' ? 'ok' : d.status)}</StatusLabel>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-[22px] py-6 text-text-muted">
                    {t('noMatch', { q: query })}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function EventItem({ event, devices, now }: { event: FleetEventDto; devices: DeviceDto[]; now: number }) {
  const locale = useLocale();
  const device = devices.find((d) => d.id === event.deviceId);
  const where = device
    ? `${locale === 'ar' ? device.nameAr : device.nameEn}, ${siteShort(device.siteSlug, locale)}`
    : event.deviceId;
  const when = ago(event.at, now, locale === 'ar' ? 'ar' : 'en');

  if (event.kind === 'command') {
    let label = event.title;
    try {
      const [op, args] = [
        event.title.split(' ')[0],
        JSON.parse(event.title.slice(event.title.indexOf(' ') + 1)) as { ch?: number; on?: boolean },
      ];
      if (op === 'relay.set') label = `Relay ${args.ch ?? 1} ${args.on ? 'ON' : 'OFF'}`;
    } catch {
      // keep the raw title
    }
    return (
      <li className="flex gap-3 rounded-xl bg-raised p-3">
        <span className="min-w-16 font-mono text-xs text-info">CMD</span>
        <span className="text-sm leading-snug">
          {label} · {where}
          <br />
          <span className="text-text-muted">
            {event.detail} · {when}
          </span>
        </span>
      </li>
    );
  }
  const critical = event.severity === 'critical';
  return (
    <li
      className={`flex gap-3 rounded-xl border p-3 ${
        critical ? 'border-critical/30 bg-critical/[.08]' : 'border-warning/30 bg-warning/[.08]'
      }`}
    >
      <span className={`min-w-16 font-mono text-xs ${critical ? 'text-critical' : 'text-warning'}`}>
        {critical ? 'CRITICAL' : 'WARN'}
      </span>
      <span className="text-sm leading-snug">
        {event.title} · {where}
        <br />
        <span className="text-text-muted">
          {event.detail} · {when}
        </span>
      </span>
    </li>
  );
}
