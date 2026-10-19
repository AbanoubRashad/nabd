-- Up Migration
-- Phase 2–4: refresh tokens for the API, the rules engine's per-device state, and command results.

-- Only a SHA-256 of each refresh token is stored; the token itself lives in the httpOnly cookie.
CREATE TABLE refresh_tokens (
  token_hash text PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- One row per (rule, device): the state machine in @nabd/shared/rules, persisted so a restart of ingest
-- does not forget a pending timer or an open alert.
CREATE TABLE rule_states (
  rule_id    integer NOT NULL REFERENCES alert_rules (id) ON DELETE CASCADE,
  device_id  text NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  state      jsonb NOT NULL,
  alert_id   bigint REFERENCES alerts (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, device_id)
);

-- The relay state the device reported in its `done` ack, and where the command came from.
ALTER TABLE commands ADD COLUMN result jsonb;
ALTER TABLE commands ADD COLUMN source_ip text;

-- Down Migration
ALTER TABLE commands DROP COLUMN IF EXISTS source_ip;
ALTER TABLE commands DROP COLUMN IF EXISTS result;
DROP TABLE IF EXISTS rule_states;
DROP TABLE IF EXISTS refresh_tokens;
