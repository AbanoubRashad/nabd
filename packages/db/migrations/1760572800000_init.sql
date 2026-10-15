-- Up Migration
-- Phase 0: enable TimescaleDB. Tables, hypertable and continuous aggregates arrive in Phase 1.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Down Migration
DROP EXTENSION IF EXISTS timescaledb;
