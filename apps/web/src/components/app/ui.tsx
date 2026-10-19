import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warning' | 'critical' | 'offline' | 'info' | 'muted';

export const TONE_COLOR: Record<Tone, string> = {
  ok: 'text-signal',
  warning: 'text-warning',
  critical: 'text-critical',
  offline: 'text-critical',
  info: 'text-info',
  muted: 'text-text-muted',
};

/** Status is never colour alone: each tone has its own shape (● normal, ▲ warning, ■ critical or offline). */
export const TONE_SHAPE: Record<Tone, string> = {
  ok: '●',
  warning: '▲',
  critical: '■',
  offline: '■',
  info: '●',
  muted: '○',
};

export function StatusLabel({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] whitespace-nowrap ${TONE_COLOR[tone]}`}>
      <span aria-hidden="true">{TONE_SHAPE[tone]}</span>
      {children}
    </span>
  );
}

export function Kpi({
  label,
  value,
  note,
  tone,
  noteTone,
  accent,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
  noteTone?: Tone;
  accent?: 'warning';
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-card border bg-panel p-5 ${
        accent === 'warning' ? 'border-[#5A4220]' : 'border-line-1'
      }`}
    >
      <span className="text-[13px] text-text-muted">{label}</span>
      <span className={`font-mono text-[32px] leading-tight font-medium ${tone ? TONE_COLOR[tone] : ''}`}>
        {value}
      </span>
      {note ? (
        <span className={`text-[13px] ${noteTone ? TONE_COLOR[noteTone] : 'text-text-muted'}`}>{note}</span>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[28px] leading-tight sm:text-[32px]">{title}</h1>
        {subtitle ? <span className="text-sm text-text-muted">{subtitle}</span> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-3">{children}</div> : null}
    </div>
  );
}

export function Button({
  variant = 'secondary',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const look =
    variant === 'primary'
      ? 'border-0 bg-signal font-semibold text-on-signal hover:bg-[#5BE5A8]'
      : 'border border-line-3 bg-transparent text-text hover:bg-raised';
  return (
    <button
      type="button"
      className={`min-h-11 cursor-pointer rounded-control px-[18px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${look} ${className}`}
      {...rest}
    />
  );
}

export const panelClass = 'rounded-card border border-line-1 bg-panel';

export const inputClass =
  'min-h-11 rounded-control border border-line-3 bg-ground px-3 text-[15px] text-text placeholder:text-text-muted';
