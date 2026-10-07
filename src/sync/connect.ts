import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { SyncProvider } from "./SyncProvider";

const DEFAULT_RELAY_URL = "https://wmaps-relay.innerlattice.workers.dev";

/**
 * Connects a map's Y.Doc to the relay, which keeps one Durable Object (and one
 * saved copy) per map. The map id is hashed so the relay never sees it.
 */
export async function connectSync(
  doc: Y.Doc,
  awareness: Awareness,
  mapId: string,
  relayUrl: string = import.meta.env.VITE_SYNC_RELAY_URL || DEFAULT_RELAY_URL
): Promise<SyncProvider> {
  return new SyncProvider(await roomUrl(relayUrl, mapId), doc, awareness);
}

export async function roomUrl(relayUrl: string, mapId: string): Promise<string> {
  const base = relayUrl.replace(/\/+$/, "").replace(/^http/, "ws");
  return `${base}/sync/${await hashRoom(mapId)}`;
}

async function hashRoom(mapId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`wmaps:${mapId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
