/**
 * Product text per locale. English comes straight from the shared catalogue (packages/shared/products.ts);
 * Arabic translations live here, keyed by product code, so every page that shows a product agrees.
 */
import { PRODUCTS, type Product } from '@nabd/shared';

interface ProductText {
  name: string;
  line: string;
  specs: readonly string[];
  chips: readonly string[];
  cta: string;
  alt: string;
}

const AR: Record<string, ProductText> = {
  P1: {
    name: 'عقدة الطاقة',
    line: 'الطاقة الشمسية والبطارية والحمل',
    specs: [
      'ESP32-S3 مع واي فاي وTLS',
      'جهد وتيار INA219 حتى 26 فولت',
      'ذاكرة لـ 5,000 قراءة وقت الانقطاع',
      'قراءات مباشرة على الشاشة المدمجة',
    ],
    chips: ['Wi-Fi', 'MQTT', 'OTA'],
    cta: 'شاهدها مباشرة',
    alt: 'عقدة الطاقة P1 بلون رمادي داكن وشاشة صغيرة عليها رسم أخضر',
  },
  C1: {
    name: 'عقدة المناخ',
    line: 'الهواء والرطوبة والتربة',
    specs: [
      'حرارة الهواء ورطوبته بحساس SHT31',
      'مدخل لرطوبة التربة',
      'مخرج مرحّل لمضخة أو مروحة',
      'تحديثات برامج موقّعة',
    ],
    chips: ['Wi-Fi', 'MQTT', 'OTA'],
    cta: 'شاهدها مباشرة',
    alt: 'صندوق عقدة مفتوح يظهر لوحة ESP32 والأسلاك',
  },
  F1: {
    name: 'مجس سلسلة التبريد',
    line: 'الثلاجات والمجمدات',
    specs: [
      'مجس DS18B20 مقاوم للماء من −55 إلى +125 °C',
      'حساس باب مغناطيسي',
      'تنبيه عند الخروج عن 2–8 °C',
      'تصدير سجل الحرارة كل ساعة',
    ],
    chips: ['Wi-Fi', 'MQTT', '1-Wire'],
    cta: 'شاهد تنبيهها',
    alt: 'مسجّل F1 أبيض مع مجس حرارة من الصلب وحساس باب',
  },
  R1: {
    name: 'وحدة المرحّلات',
    line: 'تشغيل المضخات والسخانات',
    specs: [
      'تركيب على قضيب DIN بقناتي مرحّل',
      'تفصل إذا انقطع الاتصال',
      'كل أمر يؤكده الجهاز',
      'زر تشغيل يدوي',
    ],
    chips: ['Wi-Fi', 'MQTT', 'DIN rail'],
    cta: 'جرّب المفتاح',
    alt: 'وحدة المرحّلات R1 بلون رمادي فاتح على قضيب DIN بأطراف خضراء',
  },
  W1: {
    name: 'وحدة تحكم المضخة',
    line: 'الضغط والتشغيل على الجاف',
    specs: [
      'مدخل حساس ضغط 4–20 mA',
      'حماية من التشغيل على الجاف',
      'عدّاد ساعات تشغيل المضخة',
      'أمان المرحّل نفسه في R1',
    ],
    chips: ['Wi-Fi', 'MQTT', '4–20 mA'],
    cta: 'اقرأ حالة الاستخدام',
    alt: '',
  },
  G1: {
    name: 'بوابة BLE',
    line: 'وسوم BLE إلى MQTT',
    specs: [
      'تنقل قراءات وسوم BLE القياسية إلى MQTT',
      'تقرأ صيغ iBeacon وEddystone',
      'اتصال عبر واي فاي أو إيثرنت',
      'تحفظ قراءات الوسوم وقت الانقطاع',
    ],
    chips: ['BLE 5', 'Wi-Fi', 'Ethernet'],
    cta: 'شاهد البنية',
    alt: 'بوابة G1 بيضاء بهوائيين وحلقة ضوء خضراء',
  },
  T1: {
    name: 'وسم حرارة BLE',
    line: 'وسم حساس ببطارية عملة',
    specs: ['يعمل ببطارية عملة', 'الحرارة والرطوبة', 'يرسل عبر بوابة G1', 'يُلصق أو يُثبّت بمسمار'],
    chips: ['BLE 5', 'Battery'],
    cta: 'شاهد البنية',
    alt: '',
  },
  K1: {
    name: 'طقم البداية',
    line: 'كل ما تحتاجه لأول عقدة',
    specs: [
      'كل مكونات P1 مع المجس والمرحّل',
      'مخطط التوصيل والبرنامج',
      'التجهيز في نحو 10 دقائق',
      'يظهر في لوحة العرض',
    ],
    chips: ['Open hardware', 'BOM'],
    cta: 'احصل على قائمة القطع',
    alt: 'مكونات طقم البداية مرتبة على سطح داكن',
  },
};

export function productText(p: Product, locale: string): ProductText {
  if (locale === 'ar' && AR[p.code]) return AR[p.code]!;
  return { name: p.name, line: p.line, specs: p.specs, chips: p.chips, cta: p.cta, alt: p.alt };
}

/** Where a product's call to action goes: its live device in the demo, or its detail page. */
export const LIVE_DEVICE: Record<string, string> = {
  P1: 'nabd-01',
  C1: 'nabd-04',
  F1: 'nabd-07',
  R1: 'nabd-05',
};

export function ctaHref(p: Product): string {
  if (p.code === 'F1') return '/alerts/rules';
  if (p.code === 'R1') return '/devices/nabd-05';
  if (LIVE_DEVICE[p.code]) return `/devices/${LIVE_DEVICE[p.code]}`;
  if (p.code === 'G1' || p.code === 'T1') return '/#architecture';
  return `/products/${p.code.toLowerCase()}`;
}

export const ALL_PRODUCTS = PRODUCTS;
