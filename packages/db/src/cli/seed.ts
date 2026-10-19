// `pnpm db:seed`: upsert the demo fleet (sites, devices, rules, one contact). Safe to run repeatedly.
import argon2 from 'argon2';
import { SEED_CONTACT, SEED_DEVICES, SEED_RULES, SEED_SITES } from '@nabd/shared';
import { readCredentials } from '../credentials.js';
import { createPool } from '../index.js';

const pool = createPool();
const credentials = readCredentials();
const client = await pool.connect();

try {
  await client.query('BEGIN');

  for (const s of SEED_SITES) {
    await client.query(
      `INSERT INTO sites (slug, name_en, name_ar, place_en, place_ar, kind, timezone, lat, lng, image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (slug) DO UPDATE SET name_en = $2, name_ar = $3, place_en = $4, place_ar = $5, kind = $6,
         timezone = $7, lat = $8, lng = $9, image = $10`,
      [s.slug, s.nameEn, s.nameAr, s.placeEn, s.placeAr, s.kind, s.timezone, s.lat, s.lng, s.image],
    );
  }

  for (const d of SEED_DEVICES) {
    const password = credentials.devices[d.id];
    const hash = password ? await argon2.hash(password, { type: argon2.argon2id }) : null;
    await client.query(
      `INSERT INTO devices (id, site_id, name_en, name_ar, kind, is_simulated, fw_version, mqtt_password_hash)
       VALUES ($1, (SELECT id FROM sites WHERE slug = $2), $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET site_id = EXCLUDED.site_id, name_en = $3, name_ar = $4, kind = $5,
         is_simulated = $6, fw_version = COALESCE(devices.fw_version, $7),
         mqtt_password_hash = COALESCE($8, devices.mqtt_password_hash)`,
      // In development every device, nabd-01 included, is simulated. Production sets NABD_REAL_DEVICE=nabd-01
      // once the board is on the desk, which also stops the simulator from publishing as it.
      [d.id, d.siteSlug, d.nameEn, d.nameAr, d.profile, d.id !== process.env.NABD_REAL_DEVICE, d.fw, hash],
    );
  }

  // Rules have no natural key, so they are matched by name.
  for (const r of SEED_RULES) {
    const values = [
      r.name,
      r.deviceId,
      r.siteSlug,
      r.metric,
      r.operator,
      r.threshold,
      r.thresholdHigh,
      r.forSeconds,
      r.clearThreshold,
      r.cooldownSeconds,
      r.severity,
      r.quietHours ? JSON.stringify(r.quietHours) : null,
      JSON.stringify(r.channels),
      r.escalateAfterSeconds,
    ];
    const updated = await client.query(
      `UPDATE alert_rules SET device_id = $2, site_id = (SELECT id FROM sites WHERE slug = $3), metric = $4,
         operator = $5, threshold = $6, threshold_high = $7, for_seconds = $8, clear_threshold = $9,
         cooldown_seconds = $10, severity = $11, quiet_hours = $12, channels = $13, escalate_after_seconds = $14
       WHERE name = $1`,
      values,
    );
    if (updated.rowCount === 0) {
      await client.query(
        `INSERT INTO alert_rules (name, device_id, site_id, metric, operator, threshold, threshold_high, for_seconds,
           clear_threshold, cooldown_seconds, severity, quiet_hours, channels, escalate_after_seconds)
         VALUES ($1, $2, (SELECT id FROM sites WHERE slug = $3), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        values,
      );
    }
  }

  const contact = await client.query<{ id: number }>(
    `INSERT INTO contacts (name, whatsapp_e164, email, locale)
     SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE name = $1)
     RETURNING id`,
    [SEED_CONTACT.name, SEED_CONTACT.whatsappE164, SEED_CONTACT.email, SEED_CONTACT.locale],
  );
  if (contact.rows[0]) {
    await client.query(
      `INSERT INTO alert_rule_contacts (rule_id, contact_id) SELECT id, $1 FROM alert_rules ON CONFLICT DO NOTHING`,
      [contact.rows[0].id],
    );
  }

  await client.query('COMMIT');
  console.log(
    `seeded ${SEED_SITES.length} sites, ${SEED_DEVICES.length} devices, ${SEED_RULES.length} rules and 1 contact`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
