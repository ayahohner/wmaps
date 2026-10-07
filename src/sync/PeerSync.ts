import type * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { Assembler, split } from "./chunks";

/**
 * Runs the Yjs sync and awareness protocols over WebRTC data channels, one per
 * peer. Messages are y-protocols frames (varUint type + payload), chunked by
 * chunks.ts. Doc updates are forwarded to every other peer, so an edit still
 * spreads if one link of the mesh is down.
 */

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/** The parts of RTCDataChannel this uses. */
export interface Channel {
  readyState: string;
  binaryType: string;
  send(data: Uint8Array<ArrayBuffer>): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: ArrayBuffer | Uint8Array }) => void) | null;
  onclose: (() => void) | null;
}

/** Transaction origin of changes received from a peer. */
export class PeerOrigin {
  constructor(readonly peerId: string) {}
}

interface PeerLink {
  channel: Channel;
  origin: PeerOrigin;
  assembler: Assembler;
  clients: Set<number>;
}

export class PeerSync {
  private readonly links = new Map<string, PeerLink>();
  private nextMessageId = 0;

  constructor(
    readonly doc: Y.Doc,
    readonly awareness: awarenessProtocol.Awareness
  ) {
    doc.on("update", this.onDocUpdate);
    awareness.on("update", this.onAwarenessUpdate);
  }

  get peerCount() {
    return this.links.size;
  }

  attach(peerId: string, channel: Channel) {
    const link = { channel, origin: new PeerOrigin(peerId), assembler: new Assembler(), clients: new Set<number>() };
    this.links.set(peerId, link);
    channel.binaryType = "arraybuffer";
    channel.onopen = () => this.greet(link);
    channel.onmessage = (e) => this.receive(link, new Uint8Array(e.data));
    channel.onclose = () => this.detach(peerId, channel);
    if (channel.readyState === "open") this.greet(link);
  }

  destroy() {
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.links.clear();
  }

  private detach(peerId: string, channel: Channel) {
    const link = this.links.get(peerId);
    if (link?.channel !== channel) return;
    this.links.delete(peerId);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...link.clients], link.origin);
  }

  private greet(link: PeerLink) {
    this.send(link, encode(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, this.doc)));
    this.send(link, this.awarenessMessage([this.doc.clientID]));
  }

  private receive(link: PeerLink, data: Uint8Array) {
    const message = link.assembler.push(data);
    if (!message) return;
    const decoder = decoding.createDecoder(message);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) this.receiveSync(link, decoder);
    else if (type === MESSAGE_AWARENESS) this.receiveAwareness(link, decoding.readVarUint8Array(decoder));
  }

  private receiveSync(link: PeerLink, decoder: decoding.Decoder) {
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, reply, this.doc, link.origin);
    if (encoding.length(reply) > 1) this.send(link, encoding.toUint8Array(reply));
  }

  private receiveAwareness(link: PeerLink, update: Uint8Array) {
    for (const { id, removed } of awarenessEntries(update)) {
      if (removed) link.clients.delete(id);
      else link.clients.add(id);
    }
    awarenessProtocol.applyAwarenessUpdate(this.awareness, update, link.origin);
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    const message = encode(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update));
    this.broadcast(message, origin);
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: Record<"added" | "updated" | "removed", number[]>,
    origin: unknown
  ) => {
    // Only our own state: peers' states reach everyone directly.
    if (origin instanceof PeerOrigin) return;
    this.broadcast(this.awarenessMessage([...added, ...updated, ...removed]), origin);
  };

  private awarenessMessage(clients: number[]) {
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients);
    return encode(MESSAGE_AWARENESS, (e) => encoding.writeVarUint8Array(e, update));
  }

  private broadcast(message: Uint8Array, origin: unknown) {
    for (const link of this.links.values()) {
      if (link.origin !== origin) this.send(link, message);
    }
  }

  private send(link: PeerLink, message: Uint8Array) {
    if (link.channel.readyState !== "open") return;
    for (const frame of split(message, this.nextMessageId++)) link.channel.send(frame as Uint8Array<ArrayBuffer>);
  }
}

/** The client ids an awareness update mentions, and whether each left. */
export function awarenessEntries(update: Uint8Array) {
  const decoder = decoding.createDecoder(update);
  return Array.from({ length: decoding.readVarUint(decoder) }, () => {
    const id = decoding.readVarUint(decoder);
    decoding.readVarUint(decoder); // clock
    return { id, removed: decoding.readVarString(decoder) === "null" };
  });
}

function encode(type: number, write: (e: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}
