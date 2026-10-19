/** In-memory Store for route tests: the demo fleet from the seed, no database. */
import { SEED_DEVICES, SEED_RULES, SEED_SITES, type SeriesSource } from '@nabd/shared';
import type { AlertDto, CommandDto, DeviceDto, FirmwareDto, RuleBody, RuleDto, SiteDto } from '@nabd/shared';
import type { CommandPatch, NewCommand, Store, StoredMessage, UserRecord } from './store.js';

export class MemoryStore implements Store {
  commands = new Map<string, CommandDto>();
  rules: RuleDto[] = SEED_RULES.map((r, i) => ({
    id: i + 1,
    name: r.name,
    deviceId: r.deviceId,
    siteSlug: r.siteSlug,
    metric: r.metric,
    operator: r.operator,
    threshold: r.threshold,
    thresholdHigh: r.thresholdHigh,
    forSeconds: r.forSeconds,
    clearThreshold: r.clearThreshold,
    cooldownSeconds: r.cooldownSeconds,
    severity: r.severity,
    quietHours: r.quietHours,
    channels: [...r.channels],
    escalateAfterSeconds: r.escalateAfterSeconds,
    enabled: true,
    state: 'ok',
  }));
  alerts: AlertDto[] = [];
  users: UserRecord[] = [];
  refresh = new Map<string, { userId: number; used: boolean }>();
  actions: { alertId: string; action: 'ack' | 'mute'; by: string }[] = [];
  messages: StoredMessage[] = [];
  minutes: { at: number; value: number }[] = [];
  firmware: (FirmwareDto & { signature: string })[] = [];
  rollouts: { version: string; deviceId: string }[] = [];
  recipients = new Map<string, string>();

  async listSites(): Promise<SiteDto[]> {
    return SEED_SITES.map((s) => ({
      slug: s.slug,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      placeEn: s.placeEn,
      placeAr: s.placeAr,
      kind: s.kind,
      timezone: s.timezone,
      lat: s.lat,
      lng: s.lng,
      image: s.image,
      status: 'ok',
      deviceIds: SEED_DEVICES.filter((d) => d.siteSlug === s.slug).map((d) => d.id),
    }));
  }
  async listDevices(): Promise<DeviceDto[]> {
    return SEED_DEVICES.map((d) => ({
      id: d.id,
      siteSlug: d.siteSlug,
      nameEn: d.nameEn,
      nameAr: d.nameAr,
      kind: d.profile,
      isSimulated: d.isSimulated,
      fwVersion: d.fw,
      online: true,
      rssi: -60,
      uptimeS: 100,
      bootReason: 'power_on',
      lastSeenAt: new Date().toISOString(),
      latest: {},
      status: 'ok',
    }));
  }
  async getDevice(id: string) {
    return (await this.listDevices()).find((d) => d.id === id) ?? null;
  }
  async series(deviceId: string, metric: string, from: Date, to: Date, source: SeriesSource) {
    return { deviceId, metric, source, from: from.toISOString(), to: to.toISOString(), points: [] };
  }
  async siteHistory() {
    return SEED_SITES.map((s) => ({ slug: s.slug, hours: Array(24).fill('ok'), uptimePct: 100 }));
  }
  async recentEvents() {
    return [];
  }
  async messagesSince(deviceId: string, afterSeq: number) {
    return this.messages.filter((m) => m.deviceId === deviceId && m.seq > afterSeq);
  }
  async createCommand(c: NewCommand) {
    const dto: CommandDto = {
      id: c.id,
      deviceId: c.deviceId,
      op: c.op,
      args: c.args,
      state: 'pending',
      requestedBy: c.requestedBy,
      createdAt: new Date().toISOString(),
      sentAt: null,
      deliveredAt: null,
      doneAt: null,
      expiresAt: c.expiresAt.toISOString(),
      error: null,
      result: null,
    };
    this.commands.set(c.id, dto);
    return dto;
  }
  async updateCommand(id: string, p: CommandPatch) {
    const c = this.commands.get(id);
    if (!c) return null;
    const next: CommandDto = {
      ...c,
      state: p.state,
      sentAt: p.sentAt?.toISOString() ?? c.sentAt,
      deliveredAt: p.deliveredAt?.toISOString() ?? c.deliveredAt,
      doneAt: p.doneAt?.toISOString() ?? c.doneAt,
      error: p.error !== undefined ? p.error : c.error,
      result: p.result ?? c.result,
    };
    this.commands.set(id, next);
    return next;
  }
  async getCommand(id: string) {
    return this.commands.get(id) ?? null;
  }
  async openCommands() {
    return [...this.commands.values()].filter((c) => ['pending', 'sent', 'delivered'].includes(c.state));
  }
  async listRules() {
    return this.rules;
  }
  async getRule(id: number) {
    return this.rules.find((r) => r.id === id) ?? null;
  }
  async createRule(rule: RuleBody) {
    const dto: RuleDto = { ...rule, id: this.rules.length + 1, state: 'ok' };
    this.rules.push(dto);
    return dto;
  }
  async updateRule(id: number, rule: RuleBody) {
    const i = this.rules.findIndex((r) => r.id === id);
    if (i < 0) return null;
    this.rules[i] = { ...rule, id, state: 'ok' };
    return this.rules[i]!;
  }
  async deleteRule(id: number) {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    return this.rules.length < before;
  }
  async minuteSeries() {
    return this.minutes;
  }
  async ruleDevices(rule: Pick<RuleDto, 'deviceId' | 'siteSlug'>) {
    if (rule.deviceId) return [rule.deviceId];
    return SEED_DEVICES.filter((d) => !rule.siteSlug || d.siteSlug === rule.siteSlug).map((d) => d.id);
  }
  async listAlerts(opts: { open?: boolean; limit: number }) {
    return this.alerts.filter((a) => !opts.open || a.state !== 'resolved').slice(0, opts.limit);
  }
  async getAlert(id: string) {
    return this.alerts.find((a) => a.id === id) ?? null;
  }
  async alertForRecipient(recipient: string) {
    return this.recipients.get(recipient) ?? null;
  }
  async requestAlertAction(alertId: string, action: 'ack' | 'mute', by: string) {
    this.actions.push({ alertId, action, by });
  }
  async listFirmware() {
    return this.firmware.map(({ signature: _s, ...f }) => f);
  }
  async getFirmware(version: string) {
    return this.firmware.find((f) => f.version === version) ?? null;
  }
  async recordRollout(version: string, deviceId: string) {
    this.rollouts.push({ version, deviceId });
  }
  async findUserByEmail(email: string) {
    return this.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }
  async getUser(id: number) {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async saveRefreshToken(hash: string, userId: number) {
    this.refresh.set(hash, { userId, used: false });
  }
  async consumeRefreshToken(hash: string) {
    const t = this.refresh.get(hash);
    if (!t || t.used) return null;
    t.used = true;
    return t.userId;
  }
  async revokeRefreshToken(hash: string) {
    const t = this.refresh.get(hash);
    if (t) t.used = true;
  }
}
