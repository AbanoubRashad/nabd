/**
 * Everything the API reads and writes, behind one interface. `PgStore` (pg-store.ts) is the real one; the
 * route tests use `MemoryStore` (memory-store.ts) so they run without a database.
 */
import type { CommandState, SeriesSource, Telemetry } from '@nabd/shared';
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

export interface UserRecord {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'viewer';
  passwordHash: string;
}

export interface NewCommand {
  id: string;
  deviceId: string;
  op: string;
  args: Record<string, unknown>;
  requestedBy: string;
  sourceIp: string | null;
  expiresAt: Date;
}

export interface CommandPatch {
  state: CommandState;
  sentAt?: Date;
  deliveredAt?: Date;
  doneAt?: Date;
  error?: string | null;
  result?: Record<string, unknown> | null;
}

/** A stored telemetry message rebuilt from narrow rows, for WebSocket back-fill. */
export interface StoredMessage {
  deviceId: string;
  seq: number;
  ts: string;
  m: Telemetry['m'];
}

export interface Store {
  listSites(): Promise<SiteDto[]>;
  listDevices(): Promise<DeviceDto[]>;
  getDevice(id: string): Promise<DeviceDto | null>;
  series(deviceId: string, metric: string, from: Date, to: Date, source: SeriesSource): Promise<SeriesDto>;
  siteHistory(): Promise<HistoryDto[]>;
  recentEvents(limit: number): Promise<FleetEventDto[]>;
  /** Readings with a seq above `afterSeq`, newer than `since`, oldest first. */
  messagesSince(deviceId: string, afterSeq: number, since: Date, limit: number): Promise<StoredMessage[]>;

  createCommand(c: NewCommand): Promise<CommandDto>;
  updateCommand(id: string, patch: CommandPatch): Promise<CommandDto | null>;
  getCommand(id: string): Promise<CommandDto | null>;
  /** Commands that were still open when the API last stopped; they are timed out on start-up. */
  openCommands(): Promise<CommandDto[]>;

  listRules(): Promise<RuleDto[]>;
  getRule(id: number): Promise<RuleDto | null>;
  createRule(rule: RuleBody): Promise<RuleDto>;
  updateRule(id: number, rule: RuleBody): Promise<RuleDto | null>;
  deleteRule(id: number): Promise<boolean>;
  /** One-minute roll-ups for a backtest: max for "above" rules, min for "below", avg otherwise. */
  minuteSeries(
    deviceId: string,
    metric: string,
    from: Date,
    to: Date,
    pick: 'min' | 'max' | 'avg',
  ): Promise<{ at: number; value: number }[]>;
  /** Devices a rule applies to (its device, its site's devices, or all). */
  ruleDevices(rule: Pick<RuleDto, 'deviceId' | 'siteSlug'>): Promise<string[]>;

  listAlerts(opts: { open?: boolean; limit: number }): Promise<AlertDto[]>;
  getAlert(id: string): Promise<AlertDto | null>;
  /** The newest open alert last notified to this WhatsApp number (for replies "1" and "2"). */
  alertForRecipient(recipient: string): Promise<string | null>;
  /** Asks ingest, which owns the rule state machine, to acknowledge or mute (Postgres NOTIFY). */
  requestAlertAction(alertId: string, action: 'ack' | 'mute', by: string): Promise<void>;

  listFirmware(): Promise<FirmwareDto[]>;
  getFirmware(version: string): Promise<(FirmwareDto & { signature: string }) | null>;
  recordRollout(version: string, deviceId: string): Promise<void>;

  findUserByEmail(email: string): Promise<UserRecord | null>;
  getUser(id: number): Promise<UserRecord | null>;
  saveRefreshToken(hash: string, userId: number, expiresAt: Date): Promise<void>;
  /** Marks the token used and returns its user, or null if unknown, expired or already used. */
  consumeRefreshToken(hash: string): Promise<number | null>;
  revokeRefreshToken(hash: string): Promise<void>;
}
