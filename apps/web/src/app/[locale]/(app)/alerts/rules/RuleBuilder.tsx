'use client';

/**
 * Rule builder (Alerts artboard): when / so it doesn't spam / then notify, a live WhatsApp preview, a 7-day
 * backtest, and the table of all rules. Anyone can try the backtest; saving and test messages need the owner.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  METRICS,
  isMetricKey,
  type AlertDto,
  type DeviceDto,
  type RuleBody,
  type RuleDto,
} from '@nabd/shared';
import { renderText } from '@nabd/notify';
import { AlertTimeline } from '@/components/app/AlertTimeline';
import { Button, inputClass, panelClass } from '@/components/app/ui';
import { Link } from '@/i18n/navigation';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import { clock } from '@/lib/format';
import { condition, formatValue, unitOf } from '@/lib/rules';
import { siteShort } from '@/lib/sites';

const EMPTY: RuleBody = {
  name: 'New rule',
  deviceId: null,
  siteSlug: null,
  metric: null,
  operator: 'gt',
  threshold: null,
  thresholdHigh: null,
  forSeconds: 300,
  clearThreshold: null,
  cooldownSeconds: 1800,
  severity: 'warning',
  quietHours: null,
  channels: ['whatsapp'],
  escalateAfterSeconds: null,
  enabled: true,
};

const toBody = (r: RuleDto): RuleBody => ({
  name: r.name,
  deviceId: r.deviceId,
  siteSlug: r.siteSlug,
  metric: r.metric as RuleBody['metric'],
  operator: r.operator,
  threshold: r.threshold,
  thresholdHigh: r.thresholdHigh,
  forSeconds: r.forSeconds,
  clearThreshold: r.clearThreshold,
  cooldownSeconds: r.cooldownSeconds,
  severity: r.severity,
  quietHours: r.quietHours,
  channels: r.channels,
  escalateAfterSeconds: r.escalateAfterSeconds,
  enabled: r.enabled,
});

const DESCRIPTIONS: Record<string, string> = {
  'Medicine fridge too warm': 'Vaccines must stay between 2 and 8 °C.',
  'Device stopped reporting': 'Any device that goes quiet: a dead battery, a cut cable or lost Wi-Fi.',
  'Battery running low': 'The villa battery bank, before the inverter cuts out.',
  'Greenhouse overheating': 'Tomatoes stop setting fruit above 35 °C.',
};

async function fetchExtras(id: number, alerts: AlertDto[]) {
  const latest = alerts.find((a) => a.ruleId === id);
  const [test, detail] = await Promise.all([
    apiSend<{ fired: number }>('POST', `/alert-rules/${id}/test`).catch(() => null),
    latest ? apiGet<AlertDto>(`/alerts/${latest.id}`) : Promise.resolve(null),
  ]);
  return { fired: test ? test.fired : null, detail };
}

export function RuleBuilder({
  rules: initialRules,
  devices,
  alerts,
  initialRuleId,
}: {
  rules: RuleDto[];
  devices: DeviceDto[];
  alerts: AlertDto[];
  initialRuleId: number | null;
}) {
  const t = useTranslations('alerts');
  const locale = useLocale();
  const ar = locale === 'ar';
  const [rules, setRules] = useState(initialRules);
  const [selectedId, setSelectedId] = useState<number | null>(initialRuleId);
  const selected = rules.find((r) => r.id === selectedId) ?? null;
  const [form, setForm] = useState<RuleBody>(selected ? toBody(selected) : EMPTY);
  const [backtest, setBacktest] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [role, setRole] = useState<'admin' | 'viewer' | 'anon'>('anon');
  const [alert, setAlert] = useState<AlertDto | null>(null);

  useEffect(() => {
    void apiGet<{ role: 'admin' | 'viewer' | 'anon' }>('/auth/me').then((me) => me && setRole(me.role));
  }, []);

  /** The backtest and the latest alert's timeline for a rule, applied when they arrive. */
  const loadExtras = useCallback(
    (id: number) =>
      fetchExtras(id, alerts).then(({ fired, detail }) => {
        setBacktest(fired);
        setAlert(detail);
      }),
    [alerts],
  );

  useEffect(() => {
    if (initialRuleId === null) return;
    void fetchExtras(initialRuleId, alerts).then(({ fired, detail }) => {
      setBacktest(fired);
      setAlert(detail);
    });
  }, [initialRuleId, alerts]);

  function select(rule: RuleDto | null) {
    setSelectedId(rule?.id ?? null);
    setForm(rule ? toBody(rule) : EMPTY);
    setMessage(null);
    setBacktest(null);
    setAlert(null);
    if (rule) void loadExtras(rule.id);
  }

  const set = <K extends keyof RuleBody>(key: K, value: RuleBody[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const unit = unitOf(form.metric);
  const device = devices.find((d) => d.id === form.deviceId);
  const metricOptions = device
    ? Object.keys(device.latest).filter((m) => !m.startsWith('relay') && m !== 'door' && m !== 'compressor')
    : Object.keys(METRICS);

  const preview = useMemo(() => {
    const sample = form.threshold === null ? null : form.threshold + (form.operator === 'lt' ? -0.3 : 0.3);
    const place = device ? siteShort(device.siteSlug, 'en') : 'Heliopolis';
    return renderText({
      severity: form.severity,
      reason: 'opened',
      subject: `${device?.nameEn ?? form.name}, ${place}`,
      value: form.operator === 'offline' ? 'no data' : formatValue(form.metric, sample),
      detail:
        form.operator === 'offline'
          ? `No message for ${Math.round(form.forSeconds / 60)} minutes.`
          : `It has been ${form.operator === 'lt' ? 'below' : 'above'} ${formatValue(form.metric, form.threshold)} for ${Math.round(form.forSeconds / 60)} minutes.${device?.latest.door ? ` Door: ${device.latest.door.value ? 'open' : 'closed'}.` : ''}`,
      locale: 'en',
      alertId: null,
    }).split('\n');
  }, [form, device]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const saved = selected
        ? await apiSend<RuleDto>('PATCH', `/alert-rules/${selected.id}`, form)
        : await apiSend<RuleDto>('POST', '/alert-rules', form);
      setRules((list) => (selected ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved]));
      select(saved);
      setMessage(t('saved'));
    } catch (err) {
      setMessage(
        err instanceof ApiError && (err.status === 401 || err.status === 403) ? t('adminOnly') : String(err),
      );
    }
  }

  async function testMessage() {
    if (!selected) return;
    try {
      await apiSend('POST', `/alert-rules/${selected.id}/test-message`);
      setMessage(t('saved'));
    } catch (err) {
      setMessage(
        err instanceof ApiError && (err.status === 401 || err.status === 403) ? t('adminOnly') : String(err),
      );
    }
  }

  const label = 'flex flex-col gap-1.5 text-[13px] text-text-muted';
  const legend = 'pb-2.5 font-mono text-xs tracking-[0.08em] text-text-muted';
  const grid = 'grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-3';
  const num = (v: number | null) => (v === null ? '' : String(v));
  const parseNum = (s: string) => (s.trim() === '' ? null : Number(s));
  const isOffline = form.operator === 'offline';

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link href="/fleet" className="text-sm !text-text-muted">
            {t('back')}
          </Link>
          <h1 className="font-display text-[30px] leading-tight sm:text-[36px]">{t('rulesTitle')}</h1>
        </div>
        <Button variant="primary" onClick={() => select(null)}>
          {t('newRule')}
        </Button>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <form
          aria-labelledby="rb-h"
          onSubmit={(e) => void save(e)}
          className={`flex min-w-0 flex-[999_1_600px] flex-col gap-[22px] p-[26px] ${panelClass}`}
        >
          <div className="flex flex-col gap-1">
            <label className="sr-only" htmlFor="rule-name">
              {t('cols.rule')}
            </label>
            <input
              id="rule-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="border-0 bg-transparent p-0 text-xl font-semibold text-text"
            />
            <h2 id="rb-h" className="sr-only">
              {form.name}
            </h2>
            <span className="text-sm text-text-muted">{DESCRIPTIONS[form.name] ?? ''}</span>
          </div>

          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className={legend}>{t('when')}</legend>
            <div className={grid}>
              <label className={label}>
                {t('device')}
                <select
                  className={inputClass}
                  value={form.deviceId ?? ''}
                  onChange={(e) => set('deviceId', e.target.value || null)}
                >
                  <option value="">{t('anyDevice')}</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id} · {ar ? d.nameAr : d.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {t('is')}
                <select
                  className={inputClass}
                  value={form.operator}
                  onChange={(e) => set('operator', e.target.value as RuleBody['operator'])}
                >
                  {(['gt', 'lt', 'outside', 'offline'] as const).map((op) => (
                    <option key={op} value={op}>
                      {t(`ops.${op}`)}
                    </option>
                  ))}
                </select>
              </label>
              {!isOffline ? (
                <>
                  <label className={label}>
                    {t('reading')}
                    <select
                      className={inputClass}
                      value={form.metric ?? ''}
                      onChange={(e) => set('metric', (e.target.value || null) as RuleBody['metric'])}
                    >
                      <option value="" disabled>
                        —
                      </option>
                      {metricOptions.map((m) => (
                        <option key={m} value={m}>
                          {isMetricKey(m) ? METRICS[m].label[ar ? 'ar' : 'en'] : m}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={label}>
                    {t('threshold', { unit: unit || '—' })}
                    <input
                      type="number"
                      step="0.1"
                      className={`${inputClass} font-mono`}
                      value={num(form.threshold)}
                      onChange={(e) => set('threshold', parseNum(e.target.value))}
                    />
                  </label>
                  {form.operator === 'outside' ? (
                    <label className={label}>
                      {t('thresholdHigh', { unit: unit || '—' })}
                      <input
                        type="number"
                        step="0.1"
                        className={`${inputClass} font-mono`}
                        value={num(form.thresholdHigh)}
                        onChange={(e) => set('thresholdHigh', parseNum(e.target.value))}
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className={legend}>{t('spam')}</legend>
            <div className={grid}>
              <label className={label}>
                {t('forAtLeast')}
                <input
                  type="number"
                  min={0}
                  className={`${inputClass} font-mono`}
                  value={Math.round(form.forSeconds / 60)}
                  onChange={(e) => set('forSeconds', Math.max(0, Number(e.target.value)) * 60)}
                />
              </label>
              {!isOffline && form.operator !== 'outside' ? (
                <label className={label}>
                  {form.operator === 'lt'
                    ? t('clearsAbove', { unit: unit || '—' })
                    : t('clearsBelow', { unit: unit || '—' })}
                  <input
                    type="number"
                    step="0.1"
                    className={`${inputClass} font-mono`}
                    value={num(form.clearThreshold)}
                    onChange={(e) => set('clearThreshold', parseNum(e.target.value))}
                  />
                </label>
              ) : null}
              <label className={label}>
                {t('repeat')}
                <input
                  type="number"
                  min={0}
                  className={`${inputClass} font-mono`}
                  value={Math.round(form.cooldownSeconds / 60)}
                  onChange={(e) => set('cooldownSeconds', Math.max(0, Number(e.target.value)) * 60)}
                />
              </label>
              <label className={label}>
                {t('severity')}
                <select
                  className={inputClass}
                  value={form.severity}
                  onChange={(e) => set('severity', e.target.value as RuleBody['severity'])}
                >
                  <option value="warning">{t('severities.warning')}</option>
                  <option value="critical">{t('severities.critical')}</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className={legend}>{t('notify')}</legend>
            <div className="flex flex-wrap gap-3">
              {(['whatsapp', 'email'] as const).map((c) => {
                const on = form.channels.includes(c);
                return (
                  <label
                    key={c}
                    className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control border px-3.5 text-[15px] ${
                      on ? 'border-[#2C5A45] bg-signal/[.08]' : 'border-line-3'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        set(
                          'channels',
                          e.target.checked ? [...form.channels, c] : form.channels.filter((x) => x !== c),
                        )
                      }
                      className="size-[18px] accent-signal"
                    />
                    {t(c)}
                  </label>
                );
              })}
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control border border-line-3 px-3.5 text-[15px]">
                <input
                  type="checkbox"
                  checked={form.escalateAfterSeconds !== null}
                  onChange={(e) => set('escalateAfterSeconds', e.target.checked ? 900 : null)}
                  className="size-[18px] accent-signal"
                />
                {t('escalate')}
              </label>
              {form.quietHours ? (
                <span className="flex min-h-11 items-center rounded-control border border-line-3 px-3.5 text-[15px] text-text-2">
                  {t('quiet', form.quietHours)}
                </span>
              ) : null}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 pt-[18px]">
            <span className="text-sm text-text-muted" aria-live="polite">
              {selected
                ? backtest === null
                  ? t('backtesting')
                  : t.rich('backtest', {
                      n: backtest,
                      b: (chunks) => <b className="font-mono font-normal text-text">{chunks}</b>,
                    })
                : ''}
            </span>
            <div className="flex gap-2.5">
              <Button disabled={!selected} onClick={() => void testMessage()}>
                {t('testMessage')}
              </Button>
              <Button variant="primary" type="submit">
                {t('save')}
              </Button>
            </div>
          </div>
          {message ? (
            <p role="status" className="text-sm text-text-2">
              {message}
            </p>
          ) : role === 'anon' ? (
            <p className="text-[13px] text-text-muted">{t('adminOnly')}</p>
          ) : null}
        </form>

        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
          <section aria-labelledby="wa-h" className={`flex flex-col gap-3.5 p-[22px] ${panelClass}`}>
            <h2 id="wa-h" className="text-[17px] font-semibold">
              {t('preview')}
            </h2>
            <div className="flex flex-col gap-2.5 rounded-[14px] bg-[#0B141A] p-[18px]" dir="ltr" lang="en">
              <div className="flex max-w-[92%] flex-col gap-1.5 self-start rounded-[4px_12px_12px_12px] bg-[#1F2C34] px-3.5 py-3 text-sm leading-relaxed text-[#E9EDEF]">
                <span className="font-semibold">{preview[0]}</span>
                <span>{preview[1]}</span>
                <span>{preview[2]}</span>
                <span className="self-end text-[11px] text-[#A9B5BC]">
                  {alert ? clock(alert.openedAt) : '14:36'}
                </span>
              </div>
              <div className="self-end rounded-[12px_4px_12px_12px] bg-[#005C4B] px-3.5 py-2.5 text-sm text-[#E9EDEF]">
                1
              </div>
              <div className="max-w-[92%] self-start rounded-[4px_12px_12px_12px] bg-[#1F2C34] px-3.5 py-2.5 text-sm leading-normal text-[#E9EDEF]">
                {t('ackReply')}
              </div>
            </div>
            <span className="text-[13px] text-text-muted">{t('previewNote')}</span>
          </section>

          {alert ? (
            <section aria-labelledby="tl-h" className={`flex flex-col gap-3.5 p-[22px] ${panelClass}`}>
              <h2 id="tl-h" className="text-[17px] font-semibold">
                <Link href={`/alerts/${alert.id}`} className="!text-text">
                  {t('timeline')}
                </Link>
              </h2>
              <AlertTimeline alert={alert} rule={selected} />
            </section>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="rl-h" className={`overflow-x-auto ${panelClass}`}>
        <h2 id="rl-h" className="px-[22px] pt-5 pb-2 text-[17px] font-semibold">
          {t('allRules')}
        </h2>
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="text-[13px] text-text-muted">
              {(['rule', 'condition', 'notify', 'state'] as const).map((c) => (
                <th key={c} scope="col" className="px-[22px] py-3 text-start font-medium">
                  {t(`cols.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={`border-t border-line-2 ${r.id === selectedId ? 'bg-raised' : ''}`}>
                <td className="px-[22px] py-3.5">
                  <button
                    type="button"
                    onClick={() => select(r)}
                    aria-current={r.id === selectedId ? 'true' : undefined}
                    className="cursor-pointer border-0 bg-transparent p-0 text-start text-text hover:underline"
                  >
                    {r.name}
                  </button>
                </td>
                <td className="px-[22px] py-3.5 font-mono text-text-2" dir="ltr">
                  {condition(r)}
                </td>
                <td className="px-[22px] py-3.5 text-text-2">
                  {[
                    ...r.channels.map((c) => (c === 'whatsapp' ? 'WhatsApp' : 'email')),
                    ...(r.quietHours ? [`quiet ${r.quietHours.start}–${r.quietHours.end}`] : []),
                  ].join(', ')}
                </td>
                <td
                  className={`px-[22px] py-3.5 ${r.state === 'firing' ? (r.severity === 'critical' ? 'text-critical' : 'text-warning') : 'text-signal'}`}
                >
                  <span aria-hidden="true">
                    {r.state === 'firing' ? (r.severity === 'critical' ? '■ ' : '▲ ') : '● '}
                  </span>
                  {r.state === 'firing' ? t('firing') : t('ok')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
