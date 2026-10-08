import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { MapStorage } from "./MapStorage";
import { PeerMesh, type RelayMessage } from "./PeerMesh";
import { PeerSync } from "./PeerSync";
import { SaveStatus, type SyncStatus } from "./SaveStatus";
import { RelaySocket } from "./RelaySocket";

const DEFAULT_RELAY_URL = "https://wmaps-relay.innerlattice.workers.dev";
const STUN: RTCIceServer = { urls: ["stun:stun.cloudflare.com:3478"] };

export interface SyncOptions {
  relayUrl?: string;
  onStatus?: (status: SyncStatus) => void;
  /** Injected for tests and Node. */
  WebSocket?: typeof WebSocket;
  RTCPeerConnection?: typeof RTCPeerConnection;
  fetch?: typeof fetch;
}

/**
 * Multiplayer for one map: Yjs edits and cursors go peer to peer over WebRTC;
 * the relay's Durable Object does signaling and loads and saves the map.
 */
export class MapSync {
  readonly peers: PeerSync;
  readonly storage: MapStorage;
  readonly mesh: PeerMesh;
  readonly socket: RelaySocket;
  readonly saveStatus: SaveStatus;
  private readonly changed: () => void;

  constructor(url: string, private readonly doc: Y.Doc, awareness: Awareness, iceServers: RTCIceServer[], opts: SyncOptions = {}) {
    const report = opts.onStatus ?? (() => {});
    report("connecting");
    this.saveStatus = new SaveStatus((message) => this.socket.sendJSON(message), report);
    this.changed = () => this.saveStatus.changed();
    this.peers = new PeerSync(doc, awareness);
    this.storage = new MapStorage(doc, (data) => this.socket.sendBinary(data));
    doc.on("update", this.changed);
    this.mesh = new PeerMesh(
      (to, data) => this.socket.sendJSON({ type: "signal", to, data }),
      (peerId, channel) => this.peers.attach(peerId, channel),
      { iceServers, RTCPeerConnection: opts.RTCPeerConnection }
    );
    this.socket = new RelaySocket(
      url,
      {
        onOpen: () => { report("connecting"); this.storage.start(); },
        onClose: () => this.saveStatus.disconnected(),
        onError: () => report("error"),
        onText: (message) => {
          if (!message || typeof message !== "object") return;
          if (!this.saveStatus.receive(message)) void this.mesh.handle(message as RelayMessage);
        },
        onBinary: (data) => {
          this.storage.receive(data);
          if (this.storage.loaded) this.saveStatus.loaded();
        },
      },
      { WebSocket: opts.WebSocket }
    );
  }

  destroy() {
    this.doc.off("update", this.changed);
    this.saveStatus.destroy();
    this.socket.destroy();
    this.mesh.destroy();
    this.peers.destroy();
    this.storage.destroy();
  }
}

export async function connectSync(
  doc: Y.Doc,
  awareness: Awareness,
  mapId: string,
  opts: SyncOptions = {}
): Promise<MapSync> {
  const relayUrl = opts.relayUrl ?? (import.meta.env.VITE_SYNC_RELAY_URL || DEFAULT_RELAY_URL);
  const [url, iceServers] = await Promise.all([roomUrl(relayUrl, mapId), fetchIceServers(relayUrl, opts.fetch)]);
  return new MapSync(url, doc, awareness, iceServers, opts);
}

export async function roomUrl(relayUrl: string, mapId: string): Promise<string> {
  return `${trimSlash(relayUrl).replace(/^http/, "ws")}/sync/${await hashRoom(mapId)}`;
}

/** STUN plus short-lived TURN credentials from the relay; STUN alone if that fails. */
export async function fetchIceServers(relayUrl: string, fetcher: typeof fetch = fetch): Promise<RTCIceServer[]> {
  try {
    const res = await fetcher(`${trimSlash(relayUrl)}/ice`);
    if (!res.ok) throw new Error(`relay /ice ${res.status}`);
    return ((await res.json()) as { iceServers: RTCIceServer[] }).iceServers;
  } catch (err) {
    console.warn("[sync] no TURN servers, using STUN only", err);
    return [STUN];
  }
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

async function hashRoom(mapId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`wmaps:${mapId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
