import { ImageResponse } from 'next/og';

export const alt = 'Nabd: every device has a pulse. Real-time IoT monitoring with real hardware.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Open Graph card in the design's dark style: the pulse mark, the headline and the live-demo pill. */
export default async function OpenGraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ar = locale === 'ar';
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: '#0A0E13',
        color: '#F2F5F8',
        backgroundImage:
          'linear-gradient(#161E28 1px, transparent 1px), linear-gradient(90deg, #161E28 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <svg width="72" height="72" viewBox="0 0 36 36">
          <rect x="0.5" y="0.5" width="35" height="35" rx="9" fill="#10161E" stroke="#2E3B4B" />
          <path
            d="M6 19 H12 L15 11 L19 26 L22 16 L24 19 H30"
            fill="none"
            stroke="#3DDC97"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span style={{ fontSize: 44, fontWeight: 800 }}>Nabd</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <span style={{ fontSize: 96, fontWeight: 800, lineHeight: 1, letterSpacing: -2 }}>
          Every device has a pulse.
        </span>
        <span style={{ fontSize: 32, color: '#B9C5D2' }}>
          ESP32 · MQTT over TLS · TimescaleDB · live dashboard · WhatsApp alerts · signed OTA
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 26, color: '#3DDC97' }}>
        <span style={{ width: 14, height: 14, borderRadius: 7, background: '#3DDC97' }} />
        {ar ? 'LIVE DEMO · English + العربية' : 'LIVE DEMO · 12 simulated nodes + 1 real board'}
      </div>
    </div>,
    size,
  );
}
