/**
 * Metric registry: the only metric keys a device may publish. Ingest rejects anything else, and the web app
 * reads units, precision and labels from here, so a new metric is one entry and no migration.
 *
 * `min`/`max` are plausibility bounds for validation (a reading outside them is a sensor or encoding fault),
 * not alert thresholds. Booleans (relay, door, compressor) are published as 0 or 1.
 */
export interface MetricDef {
  unit: string;
  min: number;
  max: number;
  /** Decimal places shown in the UI. */
  precision: number;
  label: { en: string; ar: string };
}

export const METRICS = {
  // power profile (P1)
  pv_w: {
    unit: 'W',
    min: 0,
    max: 20_000,
    precision: 0,
    label: { en: 'Solar input', ar: 'دخل الطاقة الشمسية' },
  },
  load_w: { unit: 'W', min: 0, max: 20_000, precision: 0, label: { en: 'House load', ar: 'حمل المنزل' } },
  bus_v: {
    unit: 'V',
    min: 0,
    max: 80,
    precision: 1,
    label: { en: 'Battery bus voltage', ar: 'جهد البطارية' },
  },
  soc: {
    unit: '%',
    min: 0,
    max: 100,
    precision: 0,
    label: { en: 'Battery state of charge', ar: 'شحن البطارية' },
  },
  batt_a: {
    unit: 'A',
    min: -300,
    max: 300,
    precision: 1,
    label: { en: 'Battery current', ar: 'تيار البطارية' },
  },
  batt_c: {
    unit: '°C',
    min: -40,
    max: 90,
    precision: 1,
    label: { en: 'Battery temperature', ar: 'حرارة البطارية' },
  },
  inv_w: { unit: 'W', min: 0, max: 20_000, precision: 0, label: { en: 'Inverter output', ar: 'خرج العاكس' } },
  ac_v: {
    unit: 'V',
    min: 0,
    max: 300,
    precision: 0,
    label: { en: 'AC output voltage', ar: 'جهد الخرج المتردد' },
  },
  inv_c: {
    unit: '°C',
    min: -40,
    max: 120,
    precision: 1,
    label: { en: 'Inverter temperature', ar: 'حرارة العاكس' },
  },

  // climate profile (C1)
  air_c: {
    unit: '°C',
    min: -40,
    max: 85,
    precision: 1,
    label: { en: 'Air temperature', ar: 'حرارة الهواء' },
  },
  rh: { unit: '%', min: 0, max: 100, precision: 0, label: { en: 'Humidity', ar: 'الرطوبة' } },
  soil_pct: { unit: '%', min: 0, max: 100, precision: 0, label: { en: 'Soil moisture', ar: 'رطوبة التربة' } },

  // cold-chain profile (F1)
  probe_c: {
    unit: '°C',
    min: -55,
    max: 125,
    precision: 1,
    label: { en: 'Probe temperature', ar: 'حرارة المجس' },
  },
  door: { unit: '', min: 0, max: 1, precision: 0, label: { en: 'Door open', ar: 'الباب مفتوح' } },
  compressor: {
    unit: '',
    min: 0,
    max: 1,
    precision: 0,
    label: { en: 'Compressor running', ar: 'الضاغط يعمل' },
  },
  duty_pct: {
    unit: '%',
    min: 0,
    max: 100,
    precision: 0,
    label: { en: 'Compressor duty', ar: 'تشغيل الضاغط' },
  },

  // electrical (any profile)
  current_a: { unit: 'A', min: 0, max: 200, precision: 1, label: { en: 'Current draw', ar: 'سحب التيار' } },
  power_w: {
    unit: 'W',
    min: 0,
    max: 50_000,
    precision: 0,
    label: { en: 'Power draw', ar: 'استهلاك الطاقة' },
  },

  // relay profile (R1) and the relay on other profiles
  relay1: { unit: '', min: 0, max: 1, precision: 0, label: { en: 'Relay 1', ar: 'المرحل ١' } },
  relay2: { unit: '', min: 0, max: 1, precision: 0, label: { en: 'Relay 2', ar: 'المرحل ٢' } },
} as const satisfies Record<string, MetricDef>;

export type MetricKey = keyof typeof METRICS;

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export function isMetricKey(key: string): key is MetricKey {
  return Object.hasOwn(METRICS, key);
}
