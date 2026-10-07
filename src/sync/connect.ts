import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { joinCloudflareRoom } from "./cloudflareStrategy";
import { TrysteroProvider } from "./TrysteroProvider";

/**
 * Wires a Y.Doc up for multiplayer.
 *
 * Peers find each other through our Cloudflare relay (Worker + one Durable
 * Object per map, see /relay), which only carries the encrypted WebRTC
 * handshake. Document edits then flow peer to peer, using Cloudflare STUN and,
 * when configured, TURN credentials from the relay's /ice endpoint.
 */

const APP_ID = "wmaps.innerlattice";
const DEFAULT_RELAY_URL = "https://wmaps-relay.innerlattice.workers.dev";
const ICE_TIMEOUT_MS = 2_500;
const FALLBACK_ICE: RTCIceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
];

export interface ConnectOptions {
  doc: Y.Doc;
  awareness: Awareness;
  /** Map id from the URL. */
  room: string;
  password: string;
}

/**
 * Joins the map's room once ICE servers are fetched. The caller owns the
 * Awareness, so the editor can bind cursors before the provider exists.
 */
export function connectSync(opts: ConnectOptions): Promise<TrysteroProvider> {
  const relayUrl = (
    import.meta.env.VITE_SYNC_RELAY_URL || DEFAULT_RELAY_URL
  ).replace(/\/+$/, "");

  return Promise.all([hashRoom(opts.room), fetchIceServers(relayUrl)]).then(
    ([roomId, iceServers]) =>
      new TrysteroProvider(
        opts.doc,
        joinCloudflareRoom(
          {
            appId: APP_ID,
            password: opts.password,
            rtcConfig: { iceServers },
            relayConfig: {
              urls: [`${relayUrl.replace(/^http/, "ws")}/signal/${roomId}`],
            },
          },
          roomId
        ),
        opts.awareness
      )
  );
}

/** Keeps raw map ids out of relay logs and gives a URL-safe room id. */
async function hashRoom(room: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${APP_ID}:${room}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

async function fetchIceServers(relayUrl: string): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${relayUrl}/ice`, {
      signal: AbortSignal.timeout(ICE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { iceServers?: RTCIceServer[] };
    return body.iceServers?.length ? body.iceServers : FALLBACK_ICE;
  } catch (err) {
    console.warn("[sync] using STUN only, /ice failed:", err);
    return FALLBACK_ICE;
  }
}
