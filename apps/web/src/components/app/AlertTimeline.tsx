'use client';

import { useTranslations } from 'next-intl';
import type { AlertDto, RuleDto } from '@nabd/shared';
import { clock } from '@/lib/format';
import { formatValue } from '@/lib/rules';

/** "This alert so far": the alert's events in order, ending with what will clear it. */
export function AlertTimeline({ alert, rule }: { alert: AlertDto; rule: RuleDto | null }) {
  const t = useTranslations('alerts');
  const items: { at: string | null; text: string; tone?: 'warning' | 'muted' }[] = [];
  const events = alert.events ?? [];
  const channelName = (c: string) => (c === 'whatsapp' ? 'WhatsApp' : c === 'email' ? 'email' : c);

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    switch (e.kind) {
      case 'opened': {
        const crossed = e.detail.crossedAt as string | null;
        if (crossed && rule && rule.operator !== 'offline') {
          items.push({
            at: crossed,
            text: t('events.crossed', { threshold: formatValue(rule.metric, rule.threshold) }),
          });
        }
        // Fold the first "notified" into the opening line, as in the design.
        const next = events[i + 1];
        let text = t('events.opened');
        if (next?.kind === 'notified') {
          const channels = ((next.detail.channels as string[]) ?? []).map(channelName);
          text += ` · ${t('events.notified', { channels: channels.join(' + ') })}`;
          i++;
        }
        items.push({ at: e.at, text, tone: 'warning' });
        break;
      }
      case 'notified': {
        const channels = ((e.detail.channels as string[]) ?? []).map(channelName);
        items.push({ at: e.at, text: t('events.notified', { channels: channels.join(' + ') }) });
        break;
      }
      case 'suppressed':
        items.push({
          at: e.at,
          text: t('events.suppressed', { why: String(e.detail.why ?? '') }),
          tone: 'muted',
        });
        break;
      case 'acknowledged':
        items.push({ at: e.at, text: t('events.acknowledged', { by: String(e.detail.by ?? '') }) });
        break;
      case 'muted':
        items.push({ at: e.at, text: t('events.muted', { until: clock(String(e.detail.until)) }) });
        break;
      case 'escalated':
        items.push({ at: e.at, text: t('events.escalated'), tone: 'warning' });
        break;
      case 'resolved':
        items.push({ at: e.at, text: t('events.resolved') });
        break;
    }
  }
  if (alert.state !== 'resolved' && rule) {
    const clear = rule.clearThreshold ?? rule.threshold;
    const condition =
      rule.operator === 'offline'
        ? 'the device reports again'
        : `${rule.operator === 'lt' ? 'above' : 'below'} ${formatValue(rule.metric, clear)}`;
    items.push({ at: null, text: t('events.clearsWhen', { condition }), tone: 'muted' });
  }

  return (
    <ol className="m-0 flex list-none flex-col gap-3.5 border-s-2 border-line-1 ps-[18px] text-sm">
      {items.map((item, i) => (
        <li key={i} className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-text-muted" dir="ltr">
            {item.at ? clock(item.at) : '—'}
          </span>
          <span
            className={
              item.tone === 'warning' ? 'text-warning' : item.tone === 'muted' ? 'text-text-muted' : ''
            }
          >
            {item.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
