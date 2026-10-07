// @vitest-environment node
import * as Y from "yjs";
/**
 * Live end-to-end check against the deployed relay. Skipped in normal runs;
 * `scripts/test-relay.sh` starts two of these as separate processes (each
 * needs its own Trystero peer id) and they must sync a Y.Doc via WebRTC.
 */
import { it, expect } from "vitest";
import { RTCPeerConnection } from "werift";
import { joinCloudflareRoom } from "./cloudflareStrategy";
import { TrysteroProvider } from "./TrysteroProvider";

const NativeWS = globalThis.WebSocket;
(globalThis as any).WebSocket = class extends NativeWS {
  constructor(url: string) {
    // @ts-ignore undici accepts headers
    super(url, { headers: { Origin: "https://maptogether.io" } });
  }
};

const ROLE = process.env.ROLE!;
const ROOM = process.env.ROOM!;

it.skipIf(!ROLE)(`peer ${ROLE} syncs through the live Cloudflare relay`, async () => {
  const relay = process.env.RELAY ?? "https://wmaps-relay.innerlattice.workers.dev";
  const ice = await (await fetch(`${relay}/ice`, { headers: { Origin: "https://maptogether.io" } })).json();
  const room = joinCloudflareRoom(
    {
      appId: "wmaps.e2e",
      password: "pw",
      rtcConfig: { iceServers: ice.iceServers },
      rtcPolyfill: RTCPeerConnection as unknown as typeof globalThis.RTCPeerConnection,
      relayConfig: { urls: [`${relay.replace(/^http/, "ws")}/signal/${ROOM}`] },
    },
    ROOM
  );
  const doc = new Y.Doc();
  const p = new TrysteroProvider(doc, room);
  const mine = `hello from ${ROLE}`;
  doc.getText(ROLE).insert(0, mine);
  const other = ROLE === "a" ? "b" : "a";
  const t0 = Date.now();
  while (doc.getText(other).toString() !== `hello from ${other}` && Date.now() - t0 < 20000) {
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(ROLE, "saw peer edit after", Date.now() - t0, "ms; peers:", p.peerCount);
  expect(doc.getText(other).toString()).toBe(`hello from ${other}`);
  await new Promise((r) => setTimeout(r, 3000)); // let the other side finish
  p.destroy();
}, 60000);
