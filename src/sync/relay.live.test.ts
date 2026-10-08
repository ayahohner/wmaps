// @vitest-environment node
/**
 * End-to-end check against the deployed relay (real WebRTC via werift, real
 * Durable Object). Skipped unless LIVE_RELAY is set: `yarn test:live`.
 */
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { RTCPeerConnection } from "werift";
import { expect, it } from "vitest";
import { connectSync } from "./connect";
import { until } from "./testing/fakeRelay";
import type { SyncStatus } from "./SaveStatus";

const RELAY = process.env.LIVE_RELAY;
const ORIGIN = "https://maptogether.io";

class OriginWebSocket extends WebSocket {
  constructor(url: string) {
    super(url, { headers: { Origin: ORIGIN } } as any);
  }
}

const join = async (mapId: string) => {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  let status: SyncStatus = "connecting";
  const sync = await connectSync(doc, awareness, mapId, {
    relayUrl: RELAY,
    WebSocket: OriginWebSocket as unknown as typeof WebSocket,
    RTCPeerConnection: RTCPeerConnection as unknown as typeof globalThis.RTCPeerConnection,
    fetch: (url) => fetch(url, { headers: { Origin: ORIGIN } }),
    onStatus: (next) => { status = next; },
  });
  return { doc, awareness, sync, text: doc.getText("t"), get status() { return status; } };
};

it.skipIf(!RELAY)("syncs over WebRTC and saves to the Durable Object", async () => {
  const mapId = `live-${Math.random()}`;
  const a = await join(mapId);
  const b = await join(mapId);
  await until(() => a.sync.peers.peerCount === 1 && b.sync.peers.peerCount === 1, 20000);
  b.sync.storage.destroy(); // prove b's copy comes from a, not the relay
  const start = Date.now();
  a.text.insert(0, "hello");
  await until(() => b.text.toString() === "hello");
  console.log(`peer edit after ${Date.now() - start} ms`);

  await until(() => a.status === "saved", 10000);
  a.sync.destroy();
  b.sync.destroy();
  await new Promise((r) => setTimeout(r, 3000)); // relay saves when the room empties
  const c = await join(mapId);
  await until(() => c.text.toString() === "hello", 10000);
  await until(() => c.status === "saved", 10000);
  c.sync.destroy();
}, 60000);
