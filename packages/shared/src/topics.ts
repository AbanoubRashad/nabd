/** MQTT topic root. Every topic is `nabd/v1/{siteSlug}/{deviceId}/{leaf}`. */
export const TOPIC_ROOT = 'nabd/v1';

export const TOPIC_LEAVES = ['telemetry', 'status', 'cmd', 'cmd/ack', 'ota'] as const;
export type TopicLeaf = (typeof TOPIC_LEAVES)[number];

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Builds a topic and refuses segments that could escape the device's own subtree. */
export function topic(siteSlug: string, deviceId: string, leaf: TopicLeaf): string {
  if (!SEGMENT.test(siteSlug)) throw new Error(`invalid site slug: ${siteSlug}`);
  if (!SEGMENT.test(deviceId)) throw new Error(`invalid device id: ${deviceId}`);
  return `${TOPIC_ROOT}/${siteSlug}/${deviceId}/${leaf}`;
}

export interface ParsedTopic {
  siteSlug: string;
  deviceId: string;
  leaf: TopicLeaf;
}

/** Parses an incoming topic, or returns null if it is not part of the contract. */
export function parseTopic(value: string): ParsedTopic | null {
  const parts = value.split('/');
  if (parts.length < 5 || `${parts[0]}/${parts[1]}` !== TOPIC_ROOT) return null;
  const [, , siteSlug = '', deviceId = '', ...rest] = parts;
  const leaf = rest.join('/') as TopicLeaf;
  if (!SEGMENT.test(siteSlug) || !SEGMENT.test(deviceId) || !TOPIC_LEAVES.includes(leaf)) return null;
  return { siteSlug, deviceId, leaf };
}
