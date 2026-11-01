import { createServer, type Server } from 'node:net';
import { Aedes, type Client } from 'aedes';

/**
 * The demo's MQTT broker: aedes in the same process, listening on loopback only. It keeps EMQX's rules from
 * the full stack: every client has its own password, a device may only publish and subscribe under its own
 * subtree (`nabd/v1/<site>/<device>/…`), and only the `svc-` service accounts see the whole tree.
 */
export interface DemoBroker {
  url: string;
  close(): Promise<void>;
}

export function ownsTopic(clientId: string, topic: string): boolean {
  const parts = topic.split('/');
  return parts.length >= 5 && parts[0] === 'nabd' && parts[1] === 'v1' && parts[3] === clientId;
}

const isService = (username: string) => username.startsWith('svc-');

export async function startBroker(passwords: ReadonlyMap<string, string>): Promise<DemoBroker> {
  const broker = await Aedes.createBroker({
    authenticate(client, username, password, done) {
      const expected = username === undefined ? undefined : passwords.get(username);
      const ok =
        expected !== undefined &&
        password?.toString() === expected &&
        // A device must connect with its own id, so it cannot borrow another device's topic subtree.
        (isService(username!) || client.id === username);
      done(null, ok);
    },
    authorizePublish(client: Client | null, packet, done) {
      // A null client is the broker itself publishing a Last Will, which was checked on connect.
      if (!client || isService(client.id) || ownsTopic(client.id, packet.topic)) return done(null);
      done(new Error(`publish to ${packet.topic} denied`));
    },
    authorizeSubscribe(client, sub, done) {
      if (isService(client.id) || ownsTopic(client.id, sub.topic)) return done(null, sub);
      // A null subscription answers SUBACK 0x80 (failure) and keeps the client connected, as EMQX does.
      done(null, null);
    },
  });
  const server: Server = createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `mqtt://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        broker.close(() => server.close(() => resolve()));
      }),
  };
}
