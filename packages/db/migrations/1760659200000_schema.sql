-- Up Migration
-- Phase 1 schema: sites, devices, the readings hypertable with compression, retention and continuous
-- aggregates, commands, alerting, firmware, users, contacts and dead letters.
--
-- node-pg-migrate runs this file in one transaction, so every TimescaleDB call here is one that is allowed
-- inside a transaction (continuous aggregates are created WITH NO DATA; the policies fill them).
-- Single tenant: every table that would need an org_id later is keyed so one column can be added.

CREATE TABLE sites (
  id         serial PRIMARY KEY,
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name_en    text NOT NULL,
  name_ar    text NOT NULL,
  place_en   text NOT NULL,
  place_ar   text NOT NULL,
  kind       text NOT NULL,
  timezone   text NOT NULL DEFAULT 'Africa/Cairo',
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  image      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id                 text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  site_id            integer NOT NULL REFERENCES sites (id),
  name_en            text NOT NULL,
  name_ar            text NOT NULL,
  kind               text NOT NULL,
  is_simulated       boolean NOT NULL DEFAULT true,
  fw_version         text,
  last_seen_at       timestamptz,
  online             boolean NOT NULL DEFAULT false,
  rssi               smallint,
  uptime_s           bigint,
  boot_reason        text,
  -- argon2id hash of the device's MQTT password. The broker keeps its own hash; the plain secret is shown
  -- once, at provisioning.
  mqtt_password_hash text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_site_id_idx ON devices (site_id);

-- Narrow readings table (ADR 0003). TimescaleDB requires every unique index on a hypertable to include the
-- partitioning column, so the idempotency key is (device_id, seq, metric, ts). A replayed reading carries
-- the same seq and the same device timestamp, so it still collides and is dropped by ON CONFLICT DO NOTHING.
CREATE TABLE readings (
  device_id   text NOT NULL REFERENCES devices (id),
  ts          timestamptz NOT NULL,
  seq         bigint NOT NULL,
  metric      text NOT NULL,
  value       double precision NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
SELECT create_hypertable('readings', by_range('ts', INTERVAL '1 day'));
CREATE UNIQUE INDEX readings_idem_idx ON readings (device_id, seq, metric, ts);
CREATE INDEX readings_device_metric_ts_idx ON readings (device_id, metric, ts DESC);

ALTER TABLE readings SET (
  timescaledb.enable_columnstore = true,
  timescaledb.segmentby = 'device_id, metric',
  timescaledb.orderby = 'ts DESC'
);
CALL add_columnstore_policy('readings', after => INTERVAL '7 days');
SELECT add_retention_policy('readings', drop_after => INTERVAL '90 days');

-- Continuous aggregates. sum and count are stored (not avg) so the coarser levels can be built from the
-- finer ones and still give an exact average. materialized_only = false adds the not-yet-materialised tail
-- in real time, so a chart never misses the last bucket.
CREATE MATERIALIZED VIEW readings_1m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT device_id, metric, time_bucket(INTERVAL '1 minute', ts) AS bucket,
       min(value) AS min, max(value) AS max, sum(value) AS sum, count(*) AS count
FROM readings
GROUP BY device_id, metric, bucket
WITH NO DATA;

CREATE MATERIALIZED VIEW readings_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT device_id, metric, time_bucket(INTERVAL '1 hour', bucket) AS bucket,
       min(min) AS min, max(max) AS max, sum(sum) AS sum, sum(count)::bigint AS count
FROM readings_1m
GROUP BY device_id, metric, time_bucket(INTERVAL '1 hour', bucket)
WITH NO DATA;

CREATE MATERIALIZED VIEW readings_1d
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT device_id, metric, time_bucket(INTERVAL '1 day', bucket) AS bucket,
       min(min) AS min, max(max) AS max, sum(sum) AS sum, sum(count)::bigint AS count
FROM readings_1h
GROUP BY device_id, metric, time_bucket(INTERVAL '1 day', bucket)
WITH NO DATA;

-- start_offset covers the offline buffer: a node can replay ~2.8 h of 2 s readings (5,000 rows), so the
-- 1-minute level re-materialises the last day on every run.
SELECT add_continuous_aggregate_policy('readings_1m',
  start_offset => INTERVAL '1 day', end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 minute');
SELECT add_continuous_aggregate_policy('readings_1h',
  start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes');
SELECT add_continuous_aggregate_policy('readings_1d',
  start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 day', schedule_interval => INTERVAL '1 hour');

-- Messages that failed validation, kept for debugging and for the ingest metrics.
CREATE TABLE dead_letters (
  id          bigserial PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  topic       text NOT NULL,
  device_id   text,
  reason      text NOT NULL,
  payload     text NOT NULL
);
CREATE INDEX dead_letters_received_at_idx ON dead_letters (received_at DESC);

CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'viewer')),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commands (
  id           text PRIMARY KEY,
  device_id    text NOT NULL REFERENCES devices (id),
  op           text NOT NULL,
  args         jsonb NOT NULL DEFAULT '{}',
  requested_by text NOT NULL,
  state        text NOT NULL CHECK (state IN ('pending', 'sent', 'delivered', 'done', 'rejected', 'timeout')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  delivered_at timestamptz,
  done_at      timestamptz,
  expires_at   timestamptz NOT NULL,
  error        text
);
CREATE INDEX commands_device_created_idx ON commands (device_id, created_at DESC);

CREATE TABLE contacts (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  whatsapp_e164 text CHECK (whatsapp_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email         text,
  locale        text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar'))
);

CREATE TABLE alert_rules (
  id                     serial PRIMARY KEY,
  name                   text NOT NULL,
  -- Both null means the rule applies to every device.
  device_id              text REFERENCES devices (id),
  site_id                integer REFERENCES sites (id),
  metric                 text,
  operator               text NOT NULL CHECK (operator IN ('gt', 'lt', 'outside', 'offline')),
  threshold              double precision,
  threshold_high         double precision,
  for_seconds            integer NOT NULL DEFAULT 0 CHECK (for_seconds >= 0),
  clear_threshold        double precision,
  cooldown_seconds       integer NOT NULL DEFAULT 0 CHECK (cooldown_seconds >= 0),
  severity               text NOT NULL CHECK (severity IN ('warning', 'critical')),
  quiet_hours            jsonb,
  channels               jsonb NOT NULL DEFAULT '[]',
  escalate_after_seconds integer,
  enabled                boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (device_id IS NOT NULL AND site_id IS NOT NULL)),
  CHECK (operator = 'offline' OR (metric IS NOT NULL AND threshold IS NOT NULL)),
  CHECK (operator <> 'outside' OR threshold_high IS NOT NULL)
);

CREATE TABLE alert_rule_contacts (
  rule_id    integer NOT NULL REFERENCES alert_rules (id) ON DELETE CASCADE,
  contact_id integer NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, contact_id)
);

CREATE TABLE alerts (
  id              bigserial PRIMARY KEY,
  rule_id         integer NOT NULL REFERENCES alert_rules (id),
  device_id       text NOT NULL REFERENCES devices (id),
  state           text NOT NULL CHECK (state IN ('pending', 'firing', 'acknowledged', 'muted', 'resolved')),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at     timestamptz,
  peak_value      double precision
);
CREATE INDEX alerts_open_idx ON alerts (rule_id, device_id) WHERE state <> 'resolved';
CREATE INDEX alerts_opened_at_idx ON alerts (opened_at DESC);

CREATE TABLE alert_events (
  id       bigserial PRIMARY KEY,
  alert_id bigint NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  at       timestamptz NOT NULL DEFAULT now(),
  kind     text NOT NULL,
  detail   jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX alert_events_alert_idx ON alert_events (alert_id, at);

CREATE TABLE notifications (
  id                  bigserial PRIMARY KEY,
  alert_id            bigint NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('whatsapp', 'email', 'console')),
  recipient           text NOT NULL,
  provider_message_id text,
  status              text NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  attempt             smallint NOT NULL DEFAULT 1,
  error               text,
  sent_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_alert_idx ON notifications (alert_id);

CREATE TABLE firmware_releases (
  version      text PRIMARY KEY CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  signature    text NOT NULL,
  url          text NOT NULL CHECK (url LIKE 'https://%'),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  rolled_out_to jsonb NOT NULL DEFAULT '[]'
);

-- Down Migration
DROP TABLE IF EXISTS firmware_releases;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS alert_events;
DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS alert_rule_contacts;
DROP TABLE IF EXISTS alert_rules;
DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS commands;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS dead_letters;
DROP MATERIALIZED VIEW IF EXISTS readings_1d;
DROP MATERIALIZED VIEW IF EXISTS readings_1h;
DROP MATERIALIZED VIEW IF EXISTS readings_1m;
DROP TABLE IF EXISTS readings;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS sites;
