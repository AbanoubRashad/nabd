import type { Pool } from '@nabd/db';
import type { SeriesSource } from '@nabd/shared';
import type {
  AlertDto,
  CommandDto,
  DeviceDto,
  FirmwareDto,
  FleetEventDto,
  HistoryDto,
  RuleBody,
  RuleDto,
  SeriesDto,
  SiteDto,
} from './dto.js';
import type { CommandPatch, NewCommand, Store, StoredMessage, UserRecord } from './store.js';

const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : new Date(d).toISOString();

const SOURCE_TABLE: Record<Exclude<SeriesSource, 'raw'>, string> = {
  '1m': 'readings_1m',
  '1h': 'readings_1h',
  '1d': 'readings_1d',
};

type Row = Record<string, unknown>;

function toCommand(r: Row): CommandDto {
  return {
    id: r.id as string,
    deviceId: r.device_id as string,
    op: r.op as string,
    args: r.args as Record<string, unknown>,
    state: r.state as CommandDto['state'],
    requestedBy: r.requested_by as string,
    createdAt: iso(r.created_at as Date)!,
    sentAt: iso(r.sent_at as Date | null),
    deliveredAt: iso(r.delivered_at as Date | null),
    doneAt: iso(r.done_at as Date | null),
    expiresAt: iso(r.expires_at as Date)!,
    error: (r.error as string | null) ?? null,
    result: (r.result as Record<string, unknown> | null) ?? null,
  };
}

const RULE_SELECT = `
  SELECT r.*, s.slug AS site_slug,
         EXISTS (SELECT 1 FROM alerts a WHERE a.rule_id = r.id AND a.state <> 'resolved') AS firing
  FROM alert_rules r LEFT JOIN sites s ON s.id = r.site_id`;

function toRule(r: Row): RuleDto {
  return {
    id: r.id as number,
    name: r.name as string,
    deviceId: (r.device_id as string | null) ?? null,
    siteSlug: (r.site_slug as string | null) ?? null,
    metric: (r.metric as string | null) ?? null,
    operator: r.operator as RuleDto['operator'],
    threshold: (r.threshold as number | null) ?? null,
    thresholdHigh: (r.threshold_high as number | null) ?? null,
    forSeconds: r.for_seconds as number,
    clearThreshold: (r.clear_threshold as number | null) ?? null,
    cooldownSeconds: r.cooldown_seconds as number,
    severity: r.severity as RuleDto['severity'],
    quietHours: (r.quiet_hours as RuleDto['quietHours']) ?? null,
    channels: (r.channels as RuleDto['channels']) ?? [],
    escalateAfterSeconds: (r.escalate_after_seconds as number | null) ?? null,
    enabled: r.enabled as boolean,
    state: r.firing ? 'firing' : 'ok',
  };
}

const ALERT_SELECT = `
  SELECT a.*, r.name AS rule_name, r.severity, s.slug AS site_slug
  FROM alerts a
  JOIN alert_rules r ON r.id = a.rule_id
  JOIN devices d ON d.id = a.device_id
  JOIN sites s ON s.id = d.site_id`;

function toAlert(r: Row): AlertDto {
  return {
    id: String(r.id),
    ruleId: r.rule_id as number,
    ruleName: r.rule_name as string,
    deviceId: r.device_id as string,
    siteSlug: r.site_slug as string,
    severity: r.severity as AlertDto['severity'],
    state: r.state as AlertDto['state'],
    openedAt: iso(r.opened_at as Date)!,
    acknowledgedAt: iso(r.acknowledged_at as Date | null),
    acknowledgedBy: (r.acknowledged_by as string | null) ?? null,
    resolvedAt: iso(r.resolved_at as Date | null),
    peakValue: (r.peak_value as number | null) ?? null,
  };
}

function ruleValues(rule: RuleBody) {
  return [
    rule.name,
    rule.deviceId,
    rule.siteSlug,
    rule.metric,
    rule.operator,
    rule.threshold,
    rule.thresholdHigh,
    rule.forSeconds,
    rule.clearThreshold,
    rule.cooldownSeconds,
    rule.severity,
    rule.quietHours ? JSON.stringify(rule.quietHours) : null,
    JSON.stringify(rule.channels),
    rule.escalateAfterSeconds,
    rule.enabled,
  ];
}

export class PgStore implements Store {
  constructor(private readonly pool: Pool) {}

  async listSites(): Promise<SiteDto[]> {
    const { rows } = await this.pool.query(`
      SELECT s.*,
             COALESCE(array_agg(d.id ORDER BY d.id) FILTER (WHERE d.id IS NOT NULL), '{}') AS device_ids,
             COALESCE(max(CASE r.severity WHEN 'critical' THEN 2 WHEN 'warning' THEN 1 END), 0) AS worst
      FROM sites s
      LEFT JOIN devices d ON d.site_id = s.id
      LEFT JOIN alerts a ON a.device_id = d.id AND a.state <> 'resolved'
      LEFT JOIN alert_rules r ON r.id = a.rule_id
      GROUP BY s.id ORDER BY s.id`);
    return rows.map((r: Row) => ({
      slug: r.slug as string,
      nameEn: r.name_en as string,
      nameAr: r.name_ar as string,
      placeEn: r.place_en as string,
      placeAr: r.place_ar as string,
      kind: r.kind as string,
      timezone: r.timezone as string,
      lat: r.lat as number,
      lng: r.lng as number,
      image: (r.image as string | null) ?? null,
      status: (['ok', 'warning', 'critical'] as const)[r.worst as number] ?? 'ok',
      deviceIds: [...new Set(r.device_ids as string[])],
    }));
  }

  private async devices(where = '', params: unknown[] = []): Promise<DeviceDto[]> {
    const { rows } = await this.pool.query(
      `SELECT d.*, s.slug AS site_slug,
              (SELECT max(CASE r.severity WHEN 'critical' THEN 2 WHEN 'warning' THEN 1 END)
                 FROM alerts a JOIN alert_rules r ON r.id = a.rule_id
                WHERE a.device_id = d.id AND a.state <> 'resolved') AS worst,
              (SELECT jsonb_object_agg(l.metric, jsonb_build_object('value', l.value, 'ts', l.ts))
                 FROM (SELECT DISTINCT ON (metric) metric, value, ts FROM readings
                        WHERE device_id = d.id AND ts > now() - interval '1 hour'
                        ORDER BY metric, ts DESC) l) AS latest
       FROM devices d JOIN sites s ON s.id = d.site_id ${where} ORDER BY d.id`,
      params,
    );
    return rows.map((r: Row) => {
      const latest = (r.latest as Record<string, { value: number; ts: string }> | null) ?? {};
      for (const v of Object.values(latest)) v.ts = new Date(v.ts).toISOString();
      const worst = r.worst as number | null;
      return {
        id: r.id as string,
        siteSlug: r.site_slug as string,
        nameEn: r.name_en as string,
        nameAr: r.name_ar as string,
        kind: r.kind as string,
        isSimulated: r.is_simulated as boolean,
        fwVersion: (r.fw_version as string | null) ?? null,
        online: r.online as boolean,
        rssi: (r.rssi as number | null) ?? null,
        uptimeS: r.uptime_s === null ? null : Number(r.uptime_s),
        bootReason: (r.boot_reason as string | null) ?? null,
        lastSeenAt: iso(r.last_seen_at as Date | null),
        latest,
        status: !r.online ? 'offline' : worst === 2 ? 'critical' : worst === 1 ? 'warning' : 'ok',
      };
    });
  }

  listDevices() {
    return this.devices();
  }

  async getDevice(id: string) {
    return (await this.devices('WHERE d.id = $1', [id]))[0] ?? null;
  }

  async series(
    deviceId: string,
    metric: string,
    from: Date,
    to: Date,
    source: SeriesSource,
  ): Promise<SeriesDto> {
    const sql =
      source === 'raw'
        ? `SELECT ts AS t, value AS avg, value AS min, value AS max FROM readings
           WHERE device_id = $1 AND metric = $2 AND ts >= $3 AND ts < $4 ORDER BY ts LIMIT 2000`
        : `SELECT bucket AS t, sum / count AS avg, min, max FROM ${SOURCE_TABLE[source]}
           WHERE device_id = $1 AND metric = $2 AND bucket >= $3 AND bucket < $4 ORDER BY bucket LIMIT 2000`;
    const { rows } = await this.pool.query(sql, [deviceId, metric, from, to]);
    return {
      deviceId,
      metric,
      source,
      from: from.toISOString(),
      to: to.toISOString(),
      points: rows.map((r: Row) => ({
        t: iso(r.t as Date)!,
        avg: Number(r.avg),
        min: Number(r.min),
        max: Number(r.max),
      })),
    };
  }

  async siteHistory(): Promise<HistoryDto[]> {
    // For each site and each of the last 24 hours: the worst severity of any alert open during that hour.
    const { rows } = await this.pool.query(`
      WITH hours AS (
        SELECT generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') AS h
      )
      SELECT s.slug, h.h,
             COALESCE(max(CASE r.severity WHEN 'critical' THEN 2 WHEN 'warning' THEN 1 END), 0) AS worst
      FROM sites s CROSS JOIN hours h
      LEFT JOIN devices d ON d.site_id = s.id
      LEFT JOIN alerts a ON a.device_id = d.id
        AND a.opened_at < h.h + interval '1 hour' AND COALESCE(a.resolved_at, now()) >= h.h
      LEFT JOIN alert_rules r ON r.id = a.rule_id
      GROUP BY s.id, s.slug, h.h ORDER BY s.id, h.h`);
    const bySite = new Map<string, HistoryDto['hours']>();
    for (const r of rows as Row[]) {
      const list = bySite.get(r.slug as string) ?? [];
      list.push((['ok', 'warning', 'critical'] as const)[r.worst as number] ?? 'ok');
      bySite.set(r.slug as string, list);
    }
    return [...bySite].map(([slug, hours]) => ({
      slug,
      hours,
      uptimePct: Math.round((hours.filter((h) => h !== 'critical').length / hours.length) * 1000) / 10,
    }));
  }

  async recentEvents(limit: number): Promise<FleetEventDto[]> {
    const { rows } = await this.pool.query(
      `(SELECT e.at, 'alert' AS kind, r.severity, r.name AS title, e.kind AS detail, a.device_id
          FROM alert_events e JOIN alerts a ON a.id = e.alert_id JOIN alert_rules r ON r.id = a.rule_id
         WHERE e.kind IN ('opened', 'resolved', 'acknowledged', 'escalated'))
       UNION ALL
       (SELECT COALESCE(c.done_at, c.created_at), 'command', 'info',
               c.op || ' ' || c.args::text, c.state, c.device_id FROM commands c)
       ORDER BY 1 DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r: Row) => ({
      at: iso(r.at as Date)!,
      kind: r.kind as FleetEventDto['kind'],
      severity: (r.kind === 'alert' ? r.severity : 'info') as FleetEventDto['severity'],
      title: r.title as string,
      detail: r.detail as string,
      deviceId: r.device_id as string,
    }));
  }

  async messagesSince(
    deviceId: string,
    afterSeq: number,
    since: Date,
    limit: number,
  ): Promise<StoredMessage[]> {
    const { rows } = await this.pool.query(
      `SELECT seq, ts, jsonb_object_agg(metric, value) AS m FROM readings
       WHERE device_id = $1 AND seq > $2 AND ts >= $3
       GROUP BY seq, ts ORDER BY seq LIMIT $4`,
      [deviceId, afterSeq, since, limit],
    );
    return rows.map((r: Row) => ({
      deviceId,
      seq: Number(r.seq),
      ts: iso(r.ts as Date)!,
      m: r.m as StoredMessage['m'],
    }));
  }

  async createCommand(c: NewCommand): Promise<CommandDto> {
    const { rows } = await this.pool.query(
      `INSERT INTO commands (id, device_id, op, args, requested_by, state, expires_at, source_ip)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7) RETURNING *`,
      [c.id, c.deviceId, c.op, JSON.stringify(c.args), c.requestedBy, c.expiresAt, c.sourceIp],
    );
    return toCommand(rows[0] as Row);
  }

  async updateCommand(id: string, p: CommandPatch): Promise<CommandDto | null> {
    const { rows } = await this.pool.query(
      `UPDATE commands SET state = $2,
         sent_at = COALESCE($3, sent_at), delivered_at = COALESCE($4, delivered_at), done_at = COALESCE($5, done_at),
         error = CASE WHEN $6::boolean THEN $7 ELSE error END,
         result = COALESCE($8, result)
       WHERE id = $1 RETURNING *`,
      [
        id,
        p.state,
        p.sentAt ?? null,
        p.deliveredAt ?? null,
        p.doneAt ?? null,
        p.error !== undefined,
        p.error ?? null,
        p.result ? JSON.stringify(p.result) : null,
      ],
    );
    return rows[0] ? toCommand(rows[0] as Row) : null;
  }

  async getCommand(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM commands WHERE id = $1`, [id]);
    return rows[0] ? toCommand(rows[0] as Row) : null;
  }

  async openCommands() {
    const { rows } = await this.pool.query(
      `SELECT * FROM commands WHERE state IN ('pending', 'sent', 'delivered') AND created_at > now() - interval '1 day'`,
    );
    return rows.map(toCommand);
  }

  async listRules() {
    const { rows } = await this.pool.query(`${RULE_SELECT} ORDER BY r.id`);
    return rows.map(toRule);
  }

  async getRule(id: number) {
    const { rows } = await this.pool.query(`${RULE_SELECT} WHERE r.id = $1`, [id]);
    return rows[0] ? toRule(rows[0] as Row) : null;
  }

  async createRule(rule: RuleBody) {
    const { rows } = await this.pool.query(
      `INSERT INTO alert_rules (name, device_id, site_id, metric, operator, threshold, threshold_high, for_seconds,
         clear_threshold, cooldown_seconds, severity, quiet_hours, channels, escalate_after_seconds, enabled)
       VALUES ($1, $2, (SELECT id FROM sites WHERE slug = $3), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      ruleValues(rule),
    );
    return (await this.getRule((rows[0] as { id: number }).id))!;
  }

  async updateRule(id: number, rule: RuleBody) {
    const { rowCount } = await this.pool.query(
      `UPDATE alert_rules SET name = $1, device_id = $2, site_id = (SELECT id FROM sites WHERE slug = $3), metric = $4,
         operator = $5, threshold = $6, threshold_high = $7, for_seconds = $8, clear_threshold = $9,
         cooldown_seconds = $10, severity = $11, quiet_hours = $12, channels = $13, escalate_after_seconds = $14,
         enabled = $15
       WHERE id = $16`,
      [...ruleValues(rule), id],
    );
    return rowCount ? this.getRule(id) : null;
  }

  async deleteRule(id: number) {
    // Alerts keep their history: a rule with alerts is disabled instead of deleted.
    const used = await this.pool.query(`SELECT 1 FROM alerts WHERE rule_id = $1 LIMIT 1`, [id]);
    if (used.rowCount) {
      const { rowCount } = await this.pool.query(`UPDATE alert_rules SET enabled = false WHERE id = $1`, [
        id,
      ]);
      return Boolean(rowCount);
    }
    const { rowCount } = await this.pool.query(`DELETE FROM alert_rules WHERE id = $1`, [id]);
    return Boolean(rowCount);
  }

  async minuteSeries(deviceId: string, metric: string, from: Date, to: Date, pick: 'min' | 'max' | 'avg') {
    const column = pick === 'avg' ? 'sum / count' : pick; // fixed identifiers, never user input
    const { rows } = await this.pool.query(
      `SELECT bucket, ${column} AS v FROM readings_1m
       WHERE device_id = $1 AND metric = $2 AND bucket >= $3 AND bucket < $4 ORDER BY bucket`,
      [deviceId, metric, from, to],
    );
    return rows.map((r: Row) => ({ at: new Date(r.bucket as Date).getTime(), value: Number(r.v) }));
  }

  async ruleDevices(rule: Pick<RuleDto, 'deviceId' | 'siteSlug'>) {
    if (rule.deviceId) return [rule.deviceId];
    const { rows } = rule.siteSlug
      ? await this.pool.query(
          `SELECT d.id FROM devices d JOIN sites s ON s.id = d.site_id WHERE s.slug = $1`,
          [rule.siteSlug],
        )
      : await this.pool.query(`SELECT id FROM devices`);
    return rows.map((r: Row) => r.id as string);
  }

  async listAlerts(opts: { open?: boolean; limit: number }) {
    const { rows } = await this.pool.query(
      `${ALERT_SELECT} ${opts.open ? `WHERE a.state <> 'resolved'` : ''} ORDER BY a.opened_at DESC LIMIT $1`,
      [opts.limit],
    );
    return rows.map(toAlert);
  }

  async getAlert(id: string) {
    if (!/^\d+$/.test(id)) return null;
    const { rows } = await this.pool.query(`${ALERT_SELECT} WHERE a.id = $1`, [id]);
    if (!rows[0]) return null;
    const events = await this.pool.query(
      `SELECT at, kind, detail FROM alert_events WHERE alert_id = $1 ORDER BY at`,
      [id],
    );
    return {
      ...toAlert(rows[0] as Row),
      events: events.rows.map((e: Row) => ({
        at: iso(e.at as Date)!,
        kind: e.kind as string,
        detail: e.detail as Record<string, unknown>,
      })),
    };
  }

  async alertForRecipient(recipient: string) {
    const { rows } = await this.pool.query(
      `SELECT n.alert_id FROM notifications n JOIN alerts a ON a.id = n.alert_id
       WHERE n.recipient = $1 AND n.channel = 'whatsapp' AND a.state <> 'resolved'
       ORDER BY n.sent_at DESC LIMIT 1`,
      [recipient],
    );
    return rows[0] ? String((rows[0] as Row).alert_id) : null;
  }

  async requestAlertAction(alertId: string, action: 'ack' | 'mute', by: string) {
    await this.pool.query(`SELECT pg_notify('nabd_alert_actions', $1)`, [
      JSON.stringify({ alertId, action, by, at: new Date().toISOString() }),
    ]);
  }

  async listFirmware(): Promise<FirmwareDto[]> {
    const { rows } = await this.pool.query(`SELECT * FROM firmware_releases ORDER BY created_at DESC`);
    return rows.map((r: Row) => ({
      version: r.version as string,
      sha256: r.sha256 as string,
      url: r.url as string,
      notes: (r.notes as string | null) ?? null,
      createdAt: iso(r.created_at as Date)!,
    }));
  }

  async getFirmware(version: string) {
    const { rows } = await this.pool.query(`SELECT * FROM firmware_releases WHERE version = $1`, [version]);
    const r = rows[0] as Row | undefined;
    if (!r) return null;
    return {
      version: r.version as string,
      sha256: r.sha256 as string,
      url: r.url as string,
      notes: (r.notes as string | null) ?? null,
      createdAt: iso(r.created_at as Date)!,
      signature: r.signature as string,
    };
  }

  async recordRollout(version: string, deviceId: string) {
    await this.pool.query(
      `UPDATE firmware_releases SET rolled_out_to = rolled_out_to || jsonb_build_array(jsonb_build_object('device', $2::text, 'at', now()))
       WHERE version = $1`,
      [version, deviceId],
    );
  }

  private toUser(r: Row): UserRecord {
    return {
      id: r.id as number,
      email: r.email as string,
      name: r.name as string,
      role: r.role as UserRecord['role'],
      passwordHash: r.password_hash as string,
    };
  }

  async findUserByEmail(email: string) {
    const { rows } = await this.pool.query(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
    return rows[0] ? this.toUser(rows[0] as Row) : null;
  }

  async getUser(id: number) {
    const { rows } = await this.pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return rows[0] ? this.toUser(rows[0] as Row) : null;
  }

  async saveRefreshToken(hash: string, userId: number, expiresAt: Date) {
    await this.pool.query(
      `INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [hash, userId, expiresAt],
    );
  }

  async consumeRefreshToken(hash: string) {
    const { rows } = await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING user_id`,
      [hash],
    );
    return rows[0] ? ((rows[0] as Row).user_id as number) : null;
  }

  async revokeRefreshToken(hash: string) {
    await this.pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [hash]);
  }
}
