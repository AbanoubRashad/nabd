/** Display details per site that the API does not carry: short names and map pin positions. */
export const SITE_SHORT: Record<string, { en: string; ar: string }> = {
  'wadi-natrun': { en: 'Wadi El Natrun', ar: 'وادي النطرون' },
  fayoum: { en: 'Fayoum', ar: 'الفيوم' },
  heliopolis: { en: 'Heliopolis', ar: 'مصر الجديدة' },
  'tenth-of-ramadan': { en: '10th of Ramadan', ar: 'العاشر من رمضان' },
};

/** Pin positions on the 705 × 465 schematic map (from the Sites artboard). */
export const MAP_PINS: Record<string, { x: number; y: number }> = {
  'wadi-natrun': { x: 277.5, y: 207 },
  fayoum: { x: 351, y: 373.5 },
  heliopolis: { x: 424.5, y: 256.5 },
  'tenth-of-ramadan': { x: 487.5, y: 225 },
};

export const IMAGE_ALT: Record<string, { en: string; ar: string }> = {
  'wadi-natrun': {
    en: 'Solar panels on the stone roof of the villa',
    ar: 'ألواح شمسية على سطح الفيلا الحجري',
  },
  fayoum: { en: 'Tomato plants inside the greenhouse', ar: 'نباتات الطماطم داخل الصوبة' },
  heliopolis: { en: 'The clinic medicine fridge with its sensor', ar: 'ثلاجة أدوية العيادة وعليها الحساس' },
  'tenth-of-ramadan': {
    en: 'Racks of frozen goods in the cold room',
    ar: 'أرفف البضائع المجمدة في غرفة التبريد',
  },
};

export const siteShort = (slug: string, locale: string) =>
  SITE_SHORT[slug]?.[locale === 'ar' ? 'ar' : 'en'] ?? slug;

/** What each relay switches, per device (shown on the device page). */
export const RELAY_NAMES: Record<string, { en: string; ar: string }> = {
  'nabd-01': { en: 'Water heater', ar: 'سخان المياه' },
  'nabd-05': { en: 'Irrigation pump', ar: 'مضخة الري' },
  'nabd-06': { en: 'Shade motor', ar: 'محرك التظليل' },
  'nabd-12': { en: 'Test relay', ar: 'مرحّل الاختبار' },
};
