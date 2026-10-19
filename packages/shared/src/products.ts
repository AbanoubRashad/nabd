/**
 * Product catalogue. The products page, the header mega-menu and the device pages all read this list, so
 * the copy lives in one place. Copy matches docs/design-reference/Products.dc.html.
 *
 * "Prototype" means built and running on the bench. A "Planned" product is never shown as available.
 * Product photos are AI concept renders (disclosed in the footer and FAQ).
 */
export const PRODUCT_CATEGORIES = ['Sensor nodes', 'Controllers', 'Gateways', 'Sensor tags', 'Kits'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export type ProductStatus = 'Prototype' | 'Planned';

/** Decides which drivers start on the board and which metrics it publishes; stored in NVS. */
export type DeviceProfile = 'power' | 'climate' | 'coldchain' | 'relay' | 'pump' | 'gateway';

export interface Product {
  code: string;
  name: string;
  category: ProductCategory;
  status: ProductStatus;
  /** One-line use, shown in the mega-menu. */
  line: string;
  specs: readonly [string, string, string, string];
  chips: readonly string[];
  cta: string;
  /** Path under apps/web/public, or null for the dashed "Enclosure in design" placeholder. */
  image: string | null;
  alt: string;
  /** Firmware profile, or null for third-party hardware and kits. */
  profile: DeviceProfile | null;
}

export const PRODUCTS = [
  {
    code: 'P1',
    name: 'Power Node',
    category: 'Sensor nodes',
    status: 'Prototype',
    line: 'Solar, battery and load',
    specs: [
      'ESP32-S3 with Wi-Fi and TLS',
      'INA219 voltage and current, up to 26 V',
      '5,000-reading offline buffer',
      'Live readings on the built-in screen',
    ],
    chips: ['Wi-Fi', 'MQTT', 'OTA'],
    cta: 'See it live',
    image: '/images/prod-power-node.jpg',
    alt: 'Charcoal grey P1 power node with a small screen showing a green graph',
    profile: 'power',
  },
  {
    code: 'C1',
    name: 'Climate Node',
    category: 'Sensor nodes',
    status: 'Prototype',
    line: 'Air, humidity and soil',
    specs: [
      'SHT31 air temperature and humidity',
      'Soil-moisture input',
      'Relay output for a pump or fan',
      'Signed firmware updates',
    ],
    chips: ['Wi-Fi', 'MQTT', 'OTA'],
    cta: 'See it live',
    image: '/images/hero-node.jpg',
    alt: 'An open node enclosure showing the ESP32 board and wiring',
    profile: 'climate',
  },
  {
    code: 'F1',
    name: 'Cold-Chain Probe',
    category: 'Sensor nodes',
    status: 'Prototype',
    line: 'Fridges and freezers',
    specs: [
      'DS18B20 waterproof probe, −55 to +125 °C',
      'Magnetic door sensor',
      'Alerts when 2–8 °C is broken',
      'Hourly temperature log export',
    ],
    chips: ['Wi-Fi', 'MQTT', '1-Wire'],
    cta: 'See its alert',
    image: '/images/prod-coldchain-probe.jpg',
    alt: 'White F1 logger with a stainless steel temperature probe and a door sensor',
    profile: 'coldchain',
  },
  {
    code: 'R1',
    name: 'Relay Controller',
    category: 'Controllers',
    status: 'Prototype',
    line: 'Switch pumps and heaters',
    specs: [
      'DIN-rail mount, 2 relay channels',
      'Switches off if the link is lost',
      'Every command confirmed by the device',
      'Manual override button',
    ],
    chips: ['Wi-Fi', 'MQTT', 'DIN rail'],
    cta: 'Try the switch',
    image: '/images/prod-relay-controller.jpg',
    alt: 'Light grey R1 relay controller on a DIN rail with green terminals',
    profile: 'relay',
  },
  {
    code: 'W1',
    name: 'Pump Controller',
    category: 'Controllers',
    status: 'Planned',
    line: 'Pressure and dry-run',
    specs: [
      '4–20 mA pressure sensor input',
      'Dry-run protection',
      'Pump run-hour counter',
      'Same relay safety as R1',
    ],
    chips: ['Wi-Fi', 'MQTT', '4–20 mA'],
    cta: 'Read the use case',
    image: null,
    alt: '',
    profile: 'pump',
  },
  {
    code: 'G1',
    name: 'BLE Gateway',
    category: 'Gateways',
    status: 'Planned',
    line: 'BLE tags to MQTT',
    specs: [
      'Bridges standard BLE sensor tags to MQTT',
      'Reads iBeacon and Eddystone formats',
      'Wi-Fi or Ethernet uplink',
      'Buffers tag readings while offline',
    ],
    chips: ['BLE 5', 'Wi-Fi', 'Ethernet'],
    cta: 'See the architecture',
    image: '/images/prod-gateway.jpg',
    alt: 'White G1 gateway with two antennas and a green light ring',
    profile: 'gateway',
  },
  {
    code: 'T1',
    name: 'BLE Temperature Tag',
    category: 'Sensor tags',
    status: 'Planned',
    line: 'Coin-cell sensor tag',
    specs: [
      'Coin-cell powered',
      'Temperature and humidity',
      'Reports through the G1 gateway',
      'Stick-on or screw mount',
    ],
    chips: ['BLE 5', 'Battery'],
    cta: 'See the architecture',
    image: null,
    alt: '',
    profile: null,
  },
  {
    code: 'K1',
    name: 'Starter Kit',
    category: 'Kits',
    status: 'Prototype',
    line: 'Everything for a first node',
    specs: [
      'All P1 parts plus probe and relay',
      'Wiring diagram and firmware',
      'Provision in about 10 minutes',
      'Shows up on the demo dashboard',
    ],
    chips: ['Open hardware', 'BOM'],
    cta: 'Get the parts list',
    image: '/images/hardware-flatlay.jpg',
    alt: 'The starter kit parts laid out on a dark surface',
    profile: null,
  },
] as const satisfies readonly Product[];

export type ProductCode = (typeof PRODUCTS)[number]['code'];

export function getProduct(code: string): Product | undefined {
  return PRODUCTS.find((p) => p.code.toLowerCase() === code.toLowerCase());
}
