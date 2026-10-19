'use client';

/**
 * Relay switch with the three-step progress from the design. The button shows the device's *reported*
 * state; while a command is in flight it is disabled and shows "…". Timings are real: the API stamps each
 * step when the broker accepts the publish and when the device acknowledges.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CommandDto } from '@nabd/shared';
import { ApiError, apiSend } from '@/lib/api';

type Cmd = Pick<
  CommandDto,
  'id' | 'state' | 'createdAt' | 'sentAt' | 'deliveredAt' | 'doneAt' | 'error' | 'result'
>;

export interface RelayControlProps {
  deviceId: string;
  channel: 1 | 2;
  name: string;
  /** The relay state from the device's latest telemetry, or null before the first reading. */
  reported: boolean | null;
  /** When that telemetry was stamped by the device. */
  reportedAt: string | null;
  /** Every command update for this device seen on the WebSocket, by command id. */
  updates: Readonly<Record<string, Cmd>>;
}

const ms = (from: string, to: string | null) =>
  to ? `${Math.max(0, Date.parse(to) - Date.parse(from))} ms` : '';

export function RelayControl({ deviceId, channel, name, reported, reportedAt, updates }: RelayControlProps) {
  const t = useTranslations('device');
  const [created, setCreated] = useState<Cmd | null>(null);
  const [error, setError] = useState<string | null>(null);

  // WebSocket updates can arrive before the POST response; the newest known version of our command wins.
  const cmd = created ? (updates[created.id] ?? created) : null;
  const busy = cmd !== null && ['pending', 'sent', 'delivered'].includes(cmd.state);
  // The device's confirmation counts until a newer reading reports the relay itself.
  const relay = cmd?.state === 'done' ? (cmd.result?.relay as { on: boolean } | undefined) : undefined;
  const confirmedNewer = relay && cmd?.doneAt && (!reportedAt || reportedAt < cmd.doneAt);
  const on = confirmedNewer ? relay.on : (reported ?? false);

  async function toggle() {
    if (busy) return;
    setError(null);
    try {
      const command = await apiSend<CommandDto>('POST', `/devices/${deviceId}/commands`, {
        op: 'relay.set',
        args: { ch: channel, on: !on },
      });
      setCreated(command);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'error';
      setError(
        code === 'forbidden'
          ? t('forbidden')
          : code === 'rate_limited'
            ? t('rateLimited')
            : e instanceof Error
              ? e.message
              : String(e),
      );
    }
  }

  const reached = !cmd
    ? -1
    : cmd.state === 'done'
      ? 2
      : cmd.state === 'delivered'
        ? 1
        : cmd.state === 'sent'
          ? 0
          : cmd.state === 'timeout' || cmd.state === 'rejected'
            ? cmd.deliveredAt
              ? 1
              : cmd.sentAt
                ? 0
                : -1
            : -1;
  const steps = [
    { label: t('steps.sent'), at: cmd ? ms(cmd.createdAt, cmd.sentAt) : '' },
    { label: t('steps.delivered'), at: cmd ? ms(cmd.createdAt, cmd.deliveredAt) : '' },
    { label: t('steps.done'), at: cmd ? ms(cmd.createdAt, cmd.doneAt) : '' },
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-semibold">{name}</span>
          <span className="text-[13px] text-text-muted">
            {t('relay', { ch: channel, pin: channel === 1 ? 4 : 5 })}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          aria-pressed={on}
          aria-label={t('relayLabel', { name })}
          aria-busy={busy}
          disabled={busy || reported === null}
          className={`min-h-12 min-w-24 cursor-pointer rounded-full border border-line-3 font-mono text-sm font-medium disabled:cursor-wait ${
            on ? 'bg-signal text-on-signal' : 'bg-raised text-text'
          }`}
        >
          {busy ? '…' : on ? 'ON' : 'OFF'}
        </button>
      </div>
      <ol aria-label={t('progress')} className="m-0 flex list-none flex-col gap-2.5 p-0" aria-live="polite">
        {steps.map((s, i) => {
          const ok = reached >= i;
          return (
            <li key={s.label} className="flex items-center gap-3 text-sm">
              <span
                className={`inline-flex size-[22px] items-center justify-center rounded-full font-mono text-xs ${
                  ok ? 'bg-signal text-on-signal' : 'bg-line-2 text-text-muted'
                }`}
                aria-hidden="true"
              >
                {ok ? '✓' : i + 1}
              </span>
              <span className={ok ? 'text-text' : 'text-text-muted'}>
                {s.label}
                <span className="sr-only">{ok ? ' ✓' : ''}</span>
              </span>
              <span className="ms-auto font-mono text-xs text-text-muted" dir="ltr">
                {ok ? s.at : ''}
              </span>
            </li>
          );
        })}
      </ol>
      {cmd?.state === 'timeout' ? (
        <p role="alert" className="text-[13px] text-warning">
          {t('timedOut')}
        </p>
      ) : null}
      {cmd?.state === 'rejected' ? (
        <p role="alert" className="text-[13px] text-critical">
          {t('rejected', { reason: cmd.error ?? '' })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-warning">
          {error}
        </p>
      ) : null}
      <p className="text-[13px] leading-normal text-text-muted">
        {t.rich('timeoutNote', {
          id: cmd?.id ?? 'c-…',
        })}
      </p>
    </div>
  );
}
