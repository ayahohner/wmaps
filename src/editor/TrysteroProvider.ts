import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { joinRoom as joinNostrRoom } from "trystero";
import type { BaseRoomConfig, MessageAction, Room } from "@trystero-p2p/core";

/**
 * Minimal Yjs provider that uses Trystero for peer discovery (signaling) and
 * WebRTC data channels for document + awareness sync.
 *
 * Replaces y-webrtc, whose public signaling servers are all gone. Trystero
 * signals over existing public networks (Nostr relays by default), so there is
 * no signaling server for us to run.
 *
 * Wire format: one Trystero action ("y") carrying Uint8Arrays. The first
 * varUint is the message type, followed by a standard y-protocols payload.
 */

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

type JoinRoomFn = (config: BaseRoomConfig, roomId: string) => Room;

export interface TrysteroProviderOptions {
  /** Unique id for the app; peers must share it to find each other. */
  appId: string;
  /** Optional shared secret used to encrypt signaling payloads. */
  password?: string;
  /** Extra TURN servers for peers behind strict NATs. */
  turnConfig?: BaseRoomConfig["turnConfig"];
  /** Full ICE config override (disables Trystero's default STUN list). */
  rtcConfig?: RTCConfiguration;
  /** Signaling strategy; defaults to Trystero's Nostr strategy. */
  joinRoom?: JoinRoomFn;
  /** Extra strategy config (e.g. relay urls). */
  relayConfig?: BaseRoomConfig["relayConfig"];
  awareness?: awarenessProtocol.Awareness;
}

type Listener = (...args: any[]) => void;

export class TrysteroProvider {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly roomName: string;
  readonly room: Room;

  private readonly action: MessageAction<Uint8Array>;
  /** Awareness client ids announced by each peer, so we can clear them on leave. */
  private readonly peerClients = new Map<string, Set<number>>();
  private readonly syncedPeers = new Set<string>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private destroyed = false;

  constructor(roomName: string, doc: Y.Doc, opts: TrysteroProviderOptions) {
    this.doc = doc;
    this.roomName = roomName;
    this.awareness = opts.awareness ?? new awarenessProtocol.Awareness(doc);

    const join = opts.joinRoom ?? (joinNostrRoom as unknown as JoinRoomFn);
    const config: BaseRoomConfig = { appId: opts.appId };
    if (opts.password) config.password = opts.password;
    if (opts.turnConfig) config.turnConfig = opts.turnConfig;
    if (opts.rtcConfig) config.rtcConfig = opts.rtcConfig;
    if (opts.relayConfig) config.relayConfig = opts.relayConfig;

    this.room = join(config, roomName);
    this.action = this.room.makeAction<Uint8Array>("y");

    this.action.onMessage = (data, { peerId }) =>
      this.handleMessage(toUint8Array(data), peerId);
    this.room.onPeerJoin = (peerId) => this.handlePeerJoin(peerId);
    this.room.onPeerLeave = (peerId) => this.handlePeerLeave(peerId);

    doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", this.onUnload);
    }
  }

  /** Number of peers we're currently connected to. */
  get peerCount(): number {
    return Object.keys(this.room.getPeers()).length;
  }

  on(event: "peers" | "synced", fn: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }

  off(event: "peers" | "synced", fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  private emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }

  private send(message: Uint8Array, target?: string) {
    if (this.destroyed) return;
    void this.action
      .send(message, target ? { target } : undefined)
      .catch((err) => console.warn("[TrysteroProvider] send failed", err));
  }

  private handlePeerJoin(peerId: string) {
    // Kick off the Yjs sync handshake with the new peer.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder), peerId);

    // Share who we are (cursor, name, colour).
    const states = this.awareness.getStates();
    if (states.size > 0) {
      this.send(
        encodeAwareness(this.awareness, Array.from(states.keys())),
        peerId
      );
    }
    this.emit("peers", { added: [peerId], removed: [], count: this.peerCount });
  }

  private handlePeerLeave(peerId: string) {
    const clients = this.peerClients.get(peerId);
    if (clients && clients.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        Array.from(clients),
        "peer-left"
      );
    }
    this.peerClients.delete(peerId);
    this.syncedPeers.delete(peerId);
    this.emit("peers", { added: [], removed: [peerId], count: this.peerCount });
  }

  private handleMessage(buf: Uint8Array, peerId: string) {
    const decoder = decoding.createDecoder(buf);
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);

    switch (type) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncType = syncProtocol.readSyncMessage(
          decoder,
          encoder,
          this.doc,
          this
        );
        if (
          syncType === syncProtocol.messageYjsSyncStep2 &&
          !this.syncedPeers.has(peerId)
        ) {
          this.syncedPeers.add(peerId);
          this.emit("synced", { peerId });
        }
        // readSyncMessage writes a reply (step 2) when it got a step 1.
        if (encoding.length(encoder) > 1) {
          this.send(encoding.toUint8Array(encoder), peerId);
        }
        break;
      }
      case MESSAGE_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        trackAwarenessClients(update, peerId, this.peerClients);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
        break;
      }
      case MESSAGE_QUERY_AWARENESS: {
        this.send(
          encodeAwareness(
            this.awareness,
            Array.from(this.awareness.getStates().keys())
          ),
          peerId
        );
        break;
      }
      default:
        console.warn("[TrysteroProvider] unknown message type", type);
    }
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // came from a peer; don't echo it back
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  private onAwarenessUpdate = (
    {
      added,
      updated,
      removed,
    }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (origin === this) return;
    const changed = added.concat(updated, removed);
    if (changed.length === 0) return;
    this.send(encodeAwareness(this.awareness, changed));
  };

  private onUnload = () => {
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      "window unload"
    );
  };

  destroy(): void {
    if (this.destroyed) return;
    this.onUnload();
    this.destroyed = true;
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.onUnload);
    }
    void this.room.leave();
  }
}

function encodeAwareness(
  awareness: awarenessProtocol.Awareness,
  clients: number[]
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, clients)
  );
  return encoding.toUint8Array(encoder);
}

/** Remember which awareness client ids a peer speaks for. */
function trackAwarenessClients(
  update: Uint8Array,
  peerId: string,
  peerClients: Map<string, Set<number>>
) {
  const decoder = decoding.createDecoder(update);
  const len = decoding.readVarUint(decoder);
  const set = peerClients.get(peerId) ?? new Set<number>();
  for (let i = 0; i < len; i++) {
    const clientId = decoding.readVarUint(decoder);
    decoding.readVarUint(decoder); // clock
    const state = JSON.parse(decoding.readVarString(decoder));
    if (state === null) set.delete(clientId);
    else set.add(clientId);
  }
  peerClients.set(peerId, set);
}

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error("[TrysteroProvider] expected binary payload");
}
