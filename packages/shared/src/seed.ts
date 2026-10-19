/**
 * The demo fleet: 4 sites, 12 devices, 4 alert rules and one contact. The simulator, the database seed and
 * the tests all read these constants, and they match the design canvas (docs/design-reference).
 */
import type { MetricKey } from './metrics.js';
import type { DeviceProfile } from './products.js';

export interface SeedSite {
  slug: string;
  nameEn: string;
  nameAr: string;
  placeEn: string;
  placeAr: string;
  kind: 'energy' | 'agriculture' | 'healthcare' | 'coldchain';
  timezone: string;
  lat: number;
  lng: number;
  image: string;
}

export const SEED_SITES = [
  {
    slug: 'wadi-natrun',
    nameEn: 'Off-grid villa',
    nameAr: 'فيلا وادي النطرون',
    placeEn: 'Wadi El Natrun, Beheira',
    placeAr: 'وادي النطرون، البحيرة',
    kind: 'energy',
    timezone: 'Africa/Cairo',
    lat: 30.384,
    lng: 30.346,
    image: '/images/site-solar-villa.jpg',
  },
  {
    slug: 'fayoum',
    nameEn: 'Tomato greenhouse',
    nameAr: 'صوبة الطماطم بالفيوم',
    placeEn: 'Fayoum',
    placeAr: 'الفيوم',
    kind: 'agriculture',
    timezone: 'Africa/Cairo',
    lat: 29.309,
    lng: 30.842,
    image: '/images/site-greenhouse.jpg',
  },
  {
    slug: 'heliopolis',
    nameEn: 'Clinic medicine fridge',
    nameAr: 'ثلاجة أدوية العيادة',
    placeEn: 'Heliopolis, Cairo',
    placeAr: 'مصر الجديدة، القاهرة',
    kind: 'healthcare',
    timezone: 'Africa/Cairo',
    lat: 30.091,
    lng: 31.322,
    image: '/images/site-clinic-fridge.jpg',
  },
  {
    slug: 'tenth-of-ramadan',
    nameEn: 'Frozen-goods cold room',
    nameAr: 'غرفة تبريد العاشر من رمضان',
    placeEn: '10th of Ramadan City, Sharqia',
    placeAr: 'العاشر من رمضان، الشرقية',
    kind: 'coldchain',
    timezone: 'Africa/Cairo',
    lat: 30.296,
    lng: 31.742,
    image: '/images/ind-coldchain.jpg',
  },
] as const satisfies readonly SeedSite[];

export type SiteSlug = (typeof SEED_SITES)[number]['slug'];

export interface SeedDevice {
  id: string;
  siteSlug: SiteSlug;
  nameEn: string;
  nameAr: string;
  profile: DeviceProfile;
  /** nabd-01 is the real ESP32 board in production; it is simulated only in development. */
  isSimulated: boolean;
  fw: string;
  metrics: readonly MetricKey[];
  /** Relay channels the device accepts `relay.set` for. */
  relays: readonly (1 | 2)[];
}

export const SEED_DEVICES = [
  {
    id: 'nabd-01',
    siteSlug: 'wadi-natrun',
    nameEn: 'Rooftop power node',
    nameAr: 'عقدة الطاقة',
    profile: 'power',
    isSimulated: false,
    fw: '1.4.2',
    metrics: ['pv_w', 'bus_v', 'soc', 'load_w', 'relay1'],
    relays: [1],
  },
  {
    id: 'nabd-02',
    siteSlug: 'wadi-natrun',
    nameEn: 'Battery bank',
    nameAr: 'بنك البطاريات',
    profile: 'power',
    isSimulated: true,
    fw: '1.4.2',
    metrics: ['bus_v', 'batt_a', 'batt_c', 'soc'],
    relays: [],
  },
  {
    id: 'nabd-03',
    siteSlug: 'wadi-natrun',
    nameEn: 'Inverter',
    nameAr: 'العاكس',
    profile: 'power',
    isSimulated: true,
    fw: '1.4.2',
    metrics: ['inv_w', 'ac_v', 'inv_c'],
    relays: [],
  },
  {
    id: 'nabd-04',
    siteSlug: 'fayoum',
    nameEn: 'Greenhouse climate',
    nameAr: 'مناخ الصوبة',
    profile: 'climate',
    isSimulated: true,
    fw: '1.4.2',
    metrics: ['air_c', 'rh'],
    relays: [],
  },
  {
    id: 'nabd-05',
    siteSlug: 'fayoum',
    nameEn: 'Irrigation pump',
    nameAr: 'مضخة الري',
    profile: 'climate',
    isSimulated: true,
    fw: '1.4.1',
    metrics: ['soil_pct', 'relay1'],
    relays: [1],
  },
  {
    id: 'nabd-06',
    siteSlug: 'fayoum',
    nameEn: 'Shade motor',
    nameAr: 'محرك التظليل',
    profile: 'relay',
    isSimulated: true,
    fw: '1.4.2',
    metrics: ['relay1'],
    relays: [1],
  },
  {
    id: 'nabd-07',
    siteSlug: 'heliopolis',
    nameEn: 'Medicine fridge',
    nameAr: 'ثلاجة الأدوية',
    profile: 'coldchain',
    isSimulated: true,
    fw: '1.4.2',
    metrics: ['probe_c', 'door', 'compressor'],
    relays: [],
  },
  {
    id: 'nabd-08',
    siteSlug: 'heliopolis',
    nameEn: 'Clinic room',
    nameAr: 'غرفة العيادة',
    profile: 'climate',
    isSimulated: true,
    fw: '1.4.2',
    metrics: ['air_c', 'rh'],
    relays: [],
  },
  {
    id: 'nabd-09',
    siteSlug: 'tenth-of-ramadan',
    nameEn: 'Cold room',
    nameAr: 'غرفة التبريد',
    profile: 'coldchain',
    isSimulated: true,
    fw: '1.4.0',
    metrics: ['probe_c', 'duty_pct'],
    relays: [],
  },
  {
    id: 'nabd-10',
    siteSlug: 'tenth-of-ramadan',
    nameEn: 'Cold room power',
    nameAr: 'طاقة غرفة التبريد',
    profile: 'power',
    isSimulated: true,
    fw: '1.4.2',
    metrics: ['current_a', 'power_w'],
    relays: [],
  },
  {
    id: 'nabd-11',
    siteSlug: 'tenth-of-ramadan',
    nameEn: 'Cold room door',
    nameAr: 'باب غرفة التبريد',
    profile: 'coldchain',
    isSimulated: true,
    fw: '1.4.0',
    metrics: ['door'],
    relays: [],
  },
  {
    id: 'nabd-12',
    siteSlug: 'wadi-natrun',
    nameEn: 'Spare test node',
    nameAr: 'عقدة اختبار احتياطية',
    profile: 'climate',
    isSimulated: true,
    fw: '1.4.2',
    metrics: ['air_c', 'rh'],
    relays: [1],
  },
] as const satisfies readonly SeedDevice[];

export type DeviceId = (typeof SEED_DEVICES)[number]['id'];

export type RuleOperator = 'gt' | 'lt' | 'outside' | 'offline';
export type Severity = 'warning' | 'critical';

export interface SeedRule {
  name: string;
  /** null with siteSlug null means every device. */
  deviceId: DeviceId | null;
  siteSlug: SiteSlug | null;
  /** null for the `offline` operator, which watches for silence instead of a value. */
  metric: MetricKey | null;
  operator: RuleOperator;
  threshold: number | null;
  thresholdHigh: number | null;
  forSeconds: number;
  /** Hysteresis: the alert clears only once the value is back past this. */
  clearThreshold: number | null;
  cooldownSeconds: number;
  severity: Severity;
  /** Local time window (site timezone) without notifications, except for critical alerts. */
  quietHours: { start: string; end: string } | null;
  channels: readonly ('whatsapp' | 'email')[];
  escalateAfterSeconds: number | null;
}

/**
 * The 4 rules from the Alerts artboard. The first one is fully specified there (8.0 °C, 5 min, clears below
 * 7.5 °C, 30 min repeat, warning, escalation off). For the others the design shows only the condition, the
 * channels and the quiet hours; the clear thresholds, cooldowns and severities are our own choices.
 */
export const SEED_RULES = [
  {
    name: 'Medicine fridge too warm',
    deviceId: 'nabd-07',
    siteSlug: null,
    metric: 'probe_c',
    operator: 'gt',
    threshold: 8.0,
    thresholdHigh: null,
    forSeconds: 5 * 60,
    clearThreshold: 7.5,
    cooldownSeconds: 30 * 60,
    severity: 'warning',
    quietHours: null,
    channels: ['whatsapp', 'email'],
    escalateAfterSeconds: null,
  },
  {
    name: 'Device stopped reporting',
    deviceId: null,
    siteSlug: null,
    metric: null,
    operator: 'offline',
    threshold: null,
    thresholdHigh: null,
    forSeconds: 5 * 60,
    clearThreshold: null,
    cooldownSeconds: 60 * 60,
    severity: 'critical',
    quietHours: null,
    channels: ['whatsapp'],
    escalateAfterSeconds: null,
  },
  {
    name: 'Battery running low',
    deviceId: 'nabd-01',
    siteSlug: null,
    metric: 'soc',
    operator: 'lt',
    threshold: 25,
    thresholdHigh: null,
    forSeconds: 10 * 60,
    clearThreshold: 30,
    cooldownSeconds: 60 * 60,
    severity: 'warning',
    quietHours: null,
    channels: ['whatsapp'],
    escalateAfterSeconds: null,
  },
  {
    name: 'Greenhouse overheating',
    deviceId: 'nabd-04',
    siteSlug: null,
    metric: 'air_c',
    operator: 'gt',
    threshold: 35,
    thresholdHigh: null,
    forSeconds: 10 * 60,
    clearThreshold: 33,
    cooldownSeconds: 60 * 60,
    severity: 'warning',
    quietHours: { start: '23:00', end: '06:00' },
    channels: ['whatsapp'],
    escalateAfterSeconds: null,
  },
] as const satisfies readonly SeedRule[];

/** Demo contact. No real phone number, ever: the console provider handles it in the demo. */
export const SEED_CONTACT = {
  name: 'Clinic manager (demo)',
  whatsappE164: null,
  email: 'demo@example.com',
  locale: 'en',
} as const;

export function siteOf(deviceId: string): SiteSlug | undefined {
  return SEED_DEVICES.find((d) => d.id === deviceId)?.siteSlug;
}
