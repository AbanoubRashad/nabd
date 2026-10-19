import type { RuleConfig, RuleState } from '@nabd/shared';

export interface EngineRule extends RuleConfig {
  id: number;
  name: string;
  deviceId: string | null;
  siteSlug: string | null;
  metric: string | null;
  channels: ('whatsapp' | 'email')[];
  enabled: boolean;
}

export interface EngineDevice {
  id: string;
  siteSlug: string;
  nameEn: string;
  nameAr: string;
  placeEn: string;
  placeAr: string;
  timezone: string;
  lastSeenAt: number | null;
}

export interface Contact {
  id: number;
  name: string;
  whatsappE164: string | null;
  email: string | null;
  locale: 'en' | 'ar';
}

export interface StoredRuleState {
  ruleId: number;
  deviceId: string;
  state: RuleState;
  alertId: string | null;
}

export interface AlertChange {
  alertId: string;
  ruleId: number;
  deviceId: string;
  state: 'firing' | 'acknowledged' | 'muted' | 'resolved';
  severity: 'warning' | 'critical';
  peakValue: number | null;
  at: string;
}

export interface NotificationRow {
  alertId: string;
  channel: 'whatsapp' | 'email' | 'console';
  recipient: string;
  status: 'sent' | 'failed';
  attempt: number;
  providerMessageId: string | null;
  error: string | null;
}

/** Persistence for the rules engine. PgRulesStore is the real one; tests use an in-memory fake. */
export interface RulesStore {
  loadRules(): Promise<EngineRule[]>;
  loadDevices(): Promise<EngineDevice[]>;
  loadStates(): Promise<StoredRuleState[]>;
  contactsFor(ruleId: number): Promise<Contact[]>;
  saveState(s: StoredRuleState): Promise<void>;
  openAlert(ruleId: number, deviceId: string, at: Date, value: number | null): Promise<string>;
  updateAlert(
    alertId: string,
    patch: {
      state: AlertChange['state'];
      peak?: number | null;
      acknowledgedAt?: Date;
      acknowledgedBy?: string;
      resolvedAt?: Date;
    },
  ): Promise<void>;
  addEvent(alertId: string, at: Date, kind: string, detail: Record<string, unknown>): Promise<void>;
  logNotification(n: NotificationRow): Promise<void>;
  /** Tells the API (and through it, every open dashboard) that an alert changed. */
  announce(change: AlertChange): Promise<void>;
  /** The rule and device behind an alert, for actions that arrive by alert id (ack, mute). */
  alertTarget(alertId: string): Promise<{ ruleId: number; deviceId: string } | null>;
}
