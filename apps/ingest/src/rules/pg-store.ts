import type { Pool } from '@nabd/db';
import type { RuleState } from '@nabd/shared';
import type {
  AlertChange,
  Contact,
  EngineDevice,
  EngineRule,
  NotificationRow,
  RulesStore,
  StoredRuleState,
} from './types.js';

type Row = Record<string, unknown>;

export class PgRulesStore implements RulesStore {
  constructor(private readonly pool: Pool) {}

  async loadRules(): Promise<EngineRule[]> {
    const { rows } = await this.pool.query(
      `SELECT r.*, s.slug AS site_slug FROM alert_rules r LEFT JOIN sites s ON s.id = r.site_id ORDER BY r.id`,
    );
    return rows.map((r: Row) => ({
      id: r.id as number,
      name: r.name as string,
      deviceId: (r.device_id as string | null) ?? null,
      siteSlug: (r.site_slug as string | null) ?? null,
      metric: (r.metric as string | null) ?? null,
      operator: r.operator as EngineRule['operator'],
      threshold: (r.threshold as number | null) ?? null,
      thresholdHigh: (r.threshold_high as number | null) ?? null,
      forSeconds: r.for_seconds as number,
      clearThreshold: (r.clear_threshold as number | null) ?? null,
      cooldownSeconds: r.cooldown_seconds as number,
      severity: r.severity as EngineRule['severity'],
      quietHours: (r.quiet_hours as EngineRule['quietHours']) ?? null,
      timezone: 'Africa/Cairo', // replaced per device by the engine
      escalateAfterSeconds: (r.escalate_after_seconds as number | null) ?? null,
      channels: (r.channels as EngineRule['channels']) ?? [],
      enabled: r.enabled as boolean,
    }));
  }

  async loadDevices(): Promise<EngineDevice[]> {
    const { rows } = await this.pool.query(
      `SELECT d.id, d.name_en, d.name_ar, d.last_seen_at, s.slug, s.place_en, s.place_ar, s.timezone
       FROM devices d JOIN sites s ON s.id = d.site_id`,
    );
    return rows.map((r: Row) => ({
      id: r.id as string,
      siteSlug: r.slug as string,
      nameEn: r.name_en as string,
      nameAr: r.name_ar as string,
      placeEn: r.place_en as string,
      placeAr: r.place_ar as string,
      timezone: r.timezone as string,
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as Date).getTime() : null,
    }));
  }

  async loadStates(): Promise<StoredRuleState[]> {
    const { rows } = await this.pool.query(`SELECT rule_id, device_id, state, alert_id FROM rule_states`);
    return rows.map((r: Row) => ({
      ruleId: r.rule_id as number,
      deviceId: r.device_id as string,
      state: r.state as RuleState,
      alertId: r.alert_id === null ? null : String(r.alert_id),
    }));
  }

  async contactsFor(ruleId: number): Promise<Contact[]> {
    const { rows } = await this.pool.query(
      `SELECT c.* FROM contacts c JOIN alert_rule_contacts rc ON rc.contact_id = c.id WHERE rc.rule_id = $1`,
      [ruleId],
    );
    return rows.map((r: Row) => ({
      id: r.id as number,
      name: r.name as string,
      whatsappE164: (r.whatsapp_e164 as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      locale: r.locale as Contact['locale'],
    }));
  }

  async saveState(s: StoredRuleState) {
    await this.pool.query(
      `INSERT INTO rule_states (rule_id, device_id, state, alert_id, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (rule_id, device_id) DO UPDATE SET state = $3, alert_id = $4, updated_at = now()`,
      [s.ruleId, s.deviceId, JSON.stringify(s.state), s.alertId],
    );
  }

  async openAlert(ruleId: number, deviceId: string, at: Date, value: number | null) {
    const { rows } = await this.pool.query(
      `INSERT INTO alerts (rule_id, device_id, state, opened_at, peak_value) VALUES ($1, $2, 'firing', $3, $4) RETURNING id`,
      [ruleId, deviceId, at, value],
    );
    return String((rows[0] as Row).id);
  }

  async updateAlert(
    id: string,
    p: {
      state: AlertChange['state'];
      peak?: number | null;
      acknowledgedAt?: Date;
      acknowledgedBy?: string;
      resolvedAt?: Date;
    },
  ) {
    await this.pool.query(
      `UPDATE alerts SET state = $2, peak_value = COALESCE($3, peak_value),
         acknowledged_at = COALESCE($4, acknowledged_at), acknowledged_by = COALESCE($5, acknowledged_by),
         resolved_at = COALESCE($6, resolved_at)
       WHERE id = $1`,
      [id, p.state, p.peak ?? null, p.acknowledgedAt ?? null, p.acknowledgedBy ?? null, p.resolvedAt ?? null],
    );
  }

  async addEvent(alertId: string, at: Date, kind: string, detail: Record<string, unknown>) {
    await this.pool.query(`INSERT INTO alert_events (alert_id, at, kind, detail) VALUES ($1, $2, $3, $4)`, [
      alertId,
      at,
      kind,
      JSON.stringify(detail),
    ]);
  }

  async logNotification(n: NotificationRow) {
    await this.pool.query(
      `INSERT INTO notifications (alert_id, channel, recipient, provider_message_id, status, attempt, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [n.alertId, n.channel, n.recipient, n.providerMessageId, n.status, n.attempt, n.error],
    );
  }

  async announce(change: AlertChange) {
    await this.pool.query(`SELECT pg_notify('nabd_alerts', $1)`, [JSON.stringify(change)]);
  }

  async alertTarget(alertId: string) {
    if (!/^\d+$/.test(alertId)) return null;
    const { rows } = await this.pool.query(`SELECT rule_id, device_id FROM alerts WHERE id = $1`, [alertId]);
    const r = rows[0] as Row | undefined;
    return r ? { ruleId: r.rule_id as number, deviceId: r.device_id as string } : null;
  }
}
