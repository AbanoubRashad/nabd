'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  METRICS,
  SEED_DEVICES,
  isMetricKey,
  type DeviceDto,
  type FirmwareDto,
  type SiteDto,
} from '@nabd/shared';
import { LiveChart, type ChartSeries } from '@/components/app/LiveChart';
import { RelayControl, type RelayControlProps } from '@/components/app/RelayControl';
import { Button, panelClass } from '@/components/app/ui';
import { Link } from '@/i18n/navigation';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import { ago, clock, formatMetric, rssi, uptime } from '@/lib/format';
import { useLive, type LiveEvent } from '@/lib/live';
import { RELAY_NAMES } from '@/lib/sites';

/** The chart metric per profile: the one an operator watches most. */
const CHART_METRIC: Record<string, string> = {
  power: 'bus_v',
  climate: 'air_c',
  coldchain: 'probe_c',
  relay: 'relay1',
};

const semver = (v: string) => v.split('.').map(Number) as [number, number, number];
const newer = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
};

interface RawLine {
  at: string;
  topic: string;
  payload: string;
}

export function DeviceView({
  device: initial,
  site,
  firmware,
}: {
  device: DeviceDto;
  site: SiteDto;
  firmware: FirmwareDto[];
}) {
  const t = useTranslations('device');
  const ts = useTranslations('app.status');
  const locale = useLocale();
  const ar = locale === 'ar';
  const [device, setDevice] = useState(initial);
  const [seq, setSeq] = useState<{ seq: number; at: number } | null>(null);
  const [raw, setRaw] = useState<RawLine[]>([]);
  const [commands, setCommands] = useState<RelayControlProps['updates']>({});
  const [now, setNow] = useState(() => Date.now());
  const [role, setRole] = useState<'admin' | 'viewer' | 'anon'>('anon');
  const [otaMessage, setOtaMessage] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ role: 'admin' | 'viewer' | 'anon' }>('/auth/me').then((me) => me && setRole(me.role));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const onEvent = useCallback(
    (e: LiveEvent) => {
      if (e.deviceId !== device.id) return;
      if (e.type === 'reading') {
        if (!e.backfilled) setSeq({ seq: e.seq, at: Date.now() });
        setDevice((d) => {
          const latest = { ...d.latest };
          for (const [k, v] of Object.entries(e.m))
            if (typeof v === 'number') latest[k] = { value: v, ts: e.ts };
          return { ...d, latest, online: true, lastSeenAt: e.ts };
        });
      } else if (e.type === 'status') {
        setDevice((d) => ({
          ...d,
          online: e.online,
          rssi: e.rssi ?? d.rssi,
          fwVersion: e.fw ?? d.fwVersion,
          uptimeS: e.uptimeS ?? d.uptimeS,
        }));
      } else if (e.type === 'command') {
        const c = e.command as RelayControlProps['updates'][string];
        setCommands((all) => ({ ...all, [c.id]: c }));
      } else if (e.type === 'raw') {
        setRaw((lines) => [{ at: e.at, topic: e.topic, payload: e.payload }, ...lines].slice(0, 8));
      }
    },
    [device.id],
  );
  const state = useLive({ devices: [device.id], raw: true }, onEvent);

  const seed = SEED_DEVICES.find((d) => d.id === device.id);
  const metrics = (seed?.metrics ?? Object.keys(device.latest)).filter((m) => !m.startsWith('relay'));
  const relays = (seed?.relays ?? []) as readonly (1 | 2)[];
  const chartMetric = CHART_METRIC[device.kind] ?? metrics[0] ?? 'relay1';
  const chartLabel = isMetricKey(chartMetric) ? METRICS[chartMetric].label[ar ? 'ar' : 'en'] : chartMetric;
  const chartSeries: ChartSeries[] = [{ metric: chartMetric, label: chartLabel, color: '#F5B13D' }];
  const release = firmware.find((f) => device.fwVersion && newer(f.version, device.fwVersion));
  const online = device.online;

  async function sendOta(version: string) {
    try {
      await apiSend('POST', `/devices/${device.id}/ota`, { version });
      setOtaMessage(t('otaSent', { v: version }));
    } catch (e) {
      setOtaMessage(e instanceof ApiError && e.status === 401 ? t('otaAdmin') : String(e));
    }
  }

  const chip = 'rounded-full border border-line-3 px-2.5 py-1';

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6">
      <nav aria-label={t('breadcrumb')} className="flex flex-wrap gap-2 text-sm text-text-muted">
        <Link href="/fleet" className="!text-text-muted">
          {t('fleet')}
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/sites?site=${site.slug}`} className="!text-text-muted">
          {ar ? `${site.nameAr}` : `${site.nameEn}, ${site.placeEn.split(',')[0]}`}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-text" aria-current="page">
          {device.id}
        </span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-[30px] leading-tight sm:text-[36px]">
            {ar ? device.nameAr : device.nameEn}
          </h1>
          <div className="flex flex-wrap gap-2 font-mono text-[13px] text-text-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 ${
                online
                  ? 'border-signal/35 bg-signal/10 text-signal'
                  : 'border-critical/40 bg-critical/10 text-critical'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block size-1.5 rounded-full ${online && state === 'live' ? 'live-dot bg-signal' : online ? 'bg-signal' : 'bg-critical'}`}
              />
              {online ? ts('ok') : ts('offline')}
            </span>
            {device.fwVersion ? <span className={chip}>{t('firmware', { v: device.fwVersion })}</span> : null}
            <span className={chip} dir="ltr">
              {t('wifi', { rssi: online ? rssi(device.rssi) : '—' })}
            </span>
            {device.uptimeS !== null && online ? (
              <span className={chip}>{t('up', { uptime: uptime(device.uptimeS) })}</span>
            ) : null}
            <span className={chip}>{device.isSimulated ? t('simulated') : t('real')}</span>
          </div>
        </div>
        <span className="font-mono text-[13px] text-text-muted" aria-live="off">
          {seq
            ? t('seq', { seq: seq.seq, age: `${((now - seq.at) / 1000).toFixed(1)} s ago` })
            : device.lastSeenAt
              ? ago(device.lastSeenAt, now, ar ? 'ar' : 'en')
              : t('waiting')}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4">
        {metrics.slice(0, 4).map((m) => {
          const value = online ? device.latest[m]?.value : undefined;
          const label = isMetricKey(m) ? METRICS[m].label[ar ? 'ar' : 'en'] : m;
          return (
            <div key={m} className={`flex flex-col gap-2.5 p-5 ${panelClass}`}>
              <span className="text-[13px] text-text-muted">{label}</span>
              <span className="font-mono text-[30px]" dir="ltr">
                {formatMetric(m, value)}
              </span>
              {m === 'soc' && typeof value === 'number' ? (
                <div className="h-2 overflow-hidden rounded-full bg-line-2" aria-hidden="true">
                  <div className="h-2 bg-signal" style={{ width: `${value}%` }} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4">
        <section
          aria-labelledby="ch-h"
          className={`flex min-w-0 flex-[999_1_560px] flex-col gap-3.5 p-[22px] ${panelClass}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <h2 id="ch-h" className="text-[17px] font-semibold">
              {t('chart', { metric: chartLabel })}
            </h2>
            <span className="text-[13px] text-text-muted">{t('chartNote', { source: '1 min' })}</span>
          </div>
          <LiveChart
            deviceId={device.id}
            series={chartSeries}
            range="24h"
            height={220}
            band
            ariaLabel={t('chart', { metric: chartLabel })}
          />
        </section>

        <section
          aria-labelledby="ct-h"
          className={`flex min-w-0 flex-[1_1_340px] flex-col gap-[18px] p-[22px] ${panelClass}`}
        >
          <h2 id="ct-h" className="text-[17px] font-semibold">
            {t('control')}
          </h2>
          {relays.length === 0 ? (
            <p className="text-sm text-text-muted">{t('noRelay')}</p>
          ) : (
            relays.map((ch) => (
              <RelayControl
                key={ch}
                deviceId={device.id}
                channel={ch}
                name={RELAY_NAMES[device.id]?.[ar ? 'ar' : 'en'] ?? `Relay ${ch}`}
                reported={
                  online && typeof device.latest[`relay${ch}`]?.value === 'number'
                    ? device.latest[`relay${ch}`]!.value === 1
                    : null
                }
                reportedAt={device.latest[`relay${ch}`]?.ts ?? null}
                updates={commands}
              />
            ))
          )}
          <div className="flex flex-col gap-2.5 border-t border-line-2 pt-4">
            <span className="font-semibold">{t('otaTitle')}</span>
            <span className="text-sm leading-normal text-text-2">
              {release
                ? t('otaReady', { v: release.version, current: device.fwVersion ?? '—' })
                : t('otaNone', { current: device.fwVersion ?? '—' })}
            </span>
            {release ? (
              <Button
                className="self-start"
                disabled={role !== 'admin'}
                title={role !== 'admin' ? t('otaAdmin') : undefined}
                onClick={() => void sendOta(release.version)}
              >
                {t('otaButton', { v: release.version })}
              </Button>
            ) : null}
            {release && role !== 'admin' ? (
              <span className="text-[13px] text-text-muted">{t('otaAdmin')}</span>
            ) : null}
            {otaMessage ? (
              <span role="status" className="text-[13px] text-text-2">
                {otaMessage}
              </span>
            ) : null}
          </div>
        </section>
      </div>

      <section
        aria-labelledby="mq-h"
        className="flex flex-col gap-3 rounded-card border border-[#1A222D] bg-[#05080C] px-[22px] py-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 id="mq-h" className="text-[15px] font-semibold">
            {t('raw')}
          </h2>
          <span className="font-mono text-xs text-text-muted" dir="ltr">
            nabd/v1/{device.siteSlug}/{device.id}/#
          </span>
        </div>
        <div className="overflow-x-auto" dir="ltr">
          {raw.length === 0 ? (
            <p className="text-[13px] text-text-muted">{t('rawEmpty')}</p>
          ) : (
            <div className="flex min-w-[760px] flex-col font-mono text-[13px] leading-[1.8]" aria-live="off">
              {raw.map((line, i) => (
                <div key={`${line.at}-${i}`} className="flex gap-4 whitespace-nowrap">
                  <span className="text-text-muted">{clock(line.at, true)}</span>
                  <span
                    className={
                      line.topic === 'telemetry'
                        ? 'text-signal'
                        : line.topic === 'cmd/ack'
                          ? 'text-info'
                          : 'text-warning'
                    }
                  >
                    {line.topic}
                  </span>
                  <span className="text-[#C5D0DC]">{line.payload}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
