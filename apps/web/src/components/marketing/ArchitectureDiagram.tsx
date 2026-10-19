/**
 * The System architecture artboard as an inline SVG. Grey: data path · blue: commands back to the device ·
 * amber: alerts · green: live push · dashed: firmware updates.
 */
const BOX = { w: 190, h: 64 };

const NODES = {
  node: { x: 20, y: 40, title: 'ESP32-S3 node', sub: 'INA219 · SHT31 · DS18B20' },
  broker: { x: 285, y: 40, title: 'MQTT broker', sub: 'EMQX · TLS 8883 · ACLs' },
  ingest: { x: 550, y: 40, title: 'Ingest worker', sub: 'validate · dedupe · batch' },
  db: { x: 815, y: 40, title: 'TimescaleDB', sub: 'hypertables · roll-ups' },
  firmware: { x: 20, y: 300, title: 'Firmware store', sub: 'signed builds · rollback' },
  api: { x: 285, y: 300, title: 'API + WebSocket', sub: 'Fastify · auth · commands' },
  rules: { x: 550, y: 300, title: 'Rules engine', sub: 'duration · hysteresis · cool-down' },
  notify: { x: 815, y: 300, title: 'WhatsApp · email', sub: 'Cloud API templates' },
  web: { x: 285, y: 470, title: 'Next.js dashboard', sub: 'English + Arabic RTL' },
} as const;

type Key = keyof typeof NODES;
const COLORS = { data: '#6B7B8D', cmd: '#6CB4FF', alert: '#F5B13D', live: '#3DDC97' } as const;

const ARROWS: {
  from: Key;
  to: Key;
  label: string;
  kind: keyof typeof COLORS;
  dashed?: boolean;
  offset?: number;
}[] = [
  { from: 'node', to: 'broker', label: 'telemetry', kind: 'data', offset: -10 },
  { from: 'broker', to: 'node', label: 'commands', kind: 'cmd', offset: 12 },
  { from: 'broker', to: 'ingest', label: 'subscribe', kind: 'data' },
  { from: 'ingest', to: 'db', label: 'batch write', kind: 'data' },
  { from: 'ingest', to: 'rules', label: 'each reading', kind: 'alert' },
  { from: 'rules', to: 'notify', label: 'alert', kind: 'alert' },
  { from: 'broker', to: 'api', label: 'live subscribe', kind: 'live' },
  { from: 'db', to: 'api', label: 'queries', kind: 'data' },
  { from: 'api', to: 'web', label: 'WebSocket push', kind: 'live' },
  { from: 'firmware', to: 'node', label: 'signed OTA', kind: 'data', dashed: true },
];

function anchor(k: Key, toward: Key, offset = 0) {
  const a = NODES[k];
  const b = NODES[toward];
  const ax = a.x + BOX.w / 2;
  const ay = a.y + BOX.h / 2;
  const bx = b.x + BOX.w / 2;
  const by = b.y + BOX.h / 2;
  if (Math.abs(bx - ax) > Math.abs(by - ay)) {
    return { x: bx > ax ? a.x + BOX.w : a.x, y: ay + offset };
  }
  return { x: ax + offset, y: by > ay ? a.y + BOX.h : a.y };
}

export function ArchitectureDiagram({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 1025 560" className="block h-auto w-full" role="img" aria-label={label} direction="ltr">
      <defs>
        {Object.entries(COLORS).map(([k, c]) => (
          <marker
            key={k}
            id={`arrow-${k}`}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 Z" fill={c} />
          </marker>
        ))}
      </defs>
      {ARROWS.map((a) => {
        let p1 = anchor(a.from, a.to, a.offset);
        let p2 = anchor(a.to, a.from, a.offset);
        // db → api runs along the bottom of the top row and up to the API.
        if (a.from === 'db' && a.to === 'api') {
          p1 = { x: NODES.db.x + 40, y: NODES.db.y + BOX.h };
          p2 = { x: NODES.api.x + BOX.w - 30, y: NODES.api.y };
        }
        const path =
          a.from === 'db' && a.to === 'api'
            ? `M${p1.x} ${p1.y} V200 H${p2.x} V${p2.y}`
            : a.from === 'broker' && a.to === 'api'
              ? `M${NODES.broker.x + 60} ${NODES.broker.y + BOX.h} V${NODES.api.y}`
              : `M${p1.x} ${p1.y} L${p2.x} ${p2.y}`;
        const mid =
          a.from === 'db' && a.to === 'api'
            ? { x: 700, y: 192 }
            : a.from === 'broker' && a.to === 'api'
              ? { x: NODES.broker.x + 68, y: 200 }
              : { x: (p1.x + p2.x) / 2 + (p1.x === p2.x ? 8 : 0), y: (p1.y + p2.y) / 2 - 8 };
        return (
          <g key={`${a.from}-${a.to}`}>
            <path
              d={path}
              fill="none"
              stroke={COLORS[a.kind]}
              strokeWidth="2"
              strokeDasharray={a.dashed ? '6 6' : undefined}
              markerEnd={`url(#arrow-${a.kind})`}
            />
            <text
              x={mid.x}
              y={mid.y}
              textAnchor={p1.x === p2.x || (a.from === 'broker' && a.to === 'api') ? 'start' : 'middle'}
              fontFamily="IBM Plex Mono, monospace"
              fontSize="12"
              fill="#93A3B5"
            >
              {a.label}
            </text>
          </g>
        );
      })}
      {Object.entries(NODES).map(([k, n]) => (
        <g key={k}>
          <rect x={n.x} y={n.y} width={BOX.w} height={BOX.h} rx="12" fill="#10161E" stroke="#2E3B4B" />
          <text
            x={n.x + 14}
            y={n.y + 27}
            fontFamily="IBM Plex Sans, sans-serif"
            fontSize="15"
            fontWeight="600"
            fill="#E7EDF3"
          >
            {n.title}
          </text>
          <text x={n.x + 14} y={n.y + 47} fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="#93A3B5">
            {n.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}
