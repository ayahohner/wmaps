import type * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

/**
 * Yjs provider for the wmaps relay (see /relay).
 *
 * One WebSocket per map to a Durable Object that holds and saves the document.
 * Messages are standard y-protocols frames: a varUint type, then the payload.
 * Text frames are only the "ping"/"pong" keepalive the relay answers without
 * waking up.
 */

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;

export interface SyncProviderOptions {
  /** Injected for tests. */
  WebSocket?: typeof WebSocket;
  pingIntervalMs?: number;
  /** Reconnect when nothing (not even a pong) arrives for this long. */
  silenceTimeoutMs?: number;
  maxBackoffMs?: number;
}

type Status = "connecting" | "connected" | "disconnected";

export class SyncProvider {
  status: Status = "disconnected";
  /** True once the relay's copy of the doc has been applied. */
  synced = false;
  onStatus: (status: Status) => void = () => {};

  private ws: WebSocket | null = null;
  private attempts = 0;
  private lastMessageAt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private destroyed = false;
  private readonly opts: Required<SyncProviderOptions>;

  constructor(
    readonly url: string,
    readonly doc: Y.Doc,
    readonly awareness: awarenessProtocol.Awareness,
    opts: SyncProviderOptions = {}
  ) {
    this.opts = {
      WebSocket: globalThis.WebSocket,
      pingIntervalMs: 20_000,
      silenceTimeoutMs: 45_000,
      maxBackoffMs: 10_000,
      ...opts,
    };
    doc.on("update", this.onDocUpdate);
    awareness.on("update", this.onAwarenessUpdate);
    this.connect();
  }

  destroy() {
    this.destroyed = true;
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      "destroy"
    );
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.clearTimers();
    this.ws?.close();
  }

  private connect() {
    const ws = new this.opts.WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => this.handleOpen();
    ws.onmessage = (e) => this.handleMessage(e.data);
    ws.onclose = () => this.handleClose(ws);
    this.ws = ws;
    this.setStatus("connecting");
  }

  private handleOpen() {
    this.attempts = 0;
    this.lastMessageAt = Date.now();
    this.setStatus("connected");
    this.send(this.encode(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, this.doc)));
    this.sendAwareness([this.doc.clientID]);
    this.timers.push(setInterval(() => this.keepAlive(), this.opts.pingIntervalMs));
  }

  private handleClose(ws: WebSocket) {
    if (ws !== this.ws) return;
    this.ws = null;
    this.synced = false;
    this.clearTimers();
    this.dropRemoteAwareness();
    this.setStatus("disconnected");
    if (this.destroyed) return;
    const delay = Math.min(this.opts.maxBackoffMs, 250 * 2 ** this.attempts++);
    this.timers.push(setTimeout(() => this.connect(), delay));
  }

  private keepAlive() {
    if (Date.now() - this.lastMessageAt > this.opts.silenceTimeoutMs) {
      this.ws?.close();
      return;
    }
    this.ws?.send("ping");
  }

  private handleMessage(data: ArrayBuffer | string) {
    this.lastMessageAt = Date.now();
    if (typeof data === "string") return;
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) this.handleSync(decoder);
    else if (type === MESSAGE_AWARENESS) this.handleAwareness(decoder);
    else if (type === MESSAGE_QUERY_AWARENESS) this.sendAwareness([this.doc.clientID]);
  }

  private handleSync(decoder: decoding.Decoder) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const kind = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
    if (kind === syncProtocol.messageYjsSyncStep2) this.synced = true;
    if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
  }

  private handleAwareness(decoder: decoding.Decoder) {
    awarenessProtocol.applyAwarenessUpdate(
      this.awareness,
      decoding.readVarUint8Array(decoder),
      this
    );
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.send(this.encode(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update)));
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: Record<"added" | "updated" | "removed", number[]>,
    origin: unknown
  ) => {
    if (origin === this) return;
    this.sendAwareness([...added, ...updated, ...removed]);
  };

  private sendAwareness(clients: number[]) {
    this.send(
      this.encode(MESSAGE_AWARENESS, (e) =>
        encoding.writeVarUint8Array(
          e,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients)
        )
      )
    );
  }

  private dropRemoteAwareness() {
    const remote = [...this.awareness.getStates().keys()].filter(
      (id) => id !== this.doc.clientID
    );
    awarenessProtocol.removeAwarenessStates(this.awareness, remote, this);
  }

  private encode(type: number, write: (e: encoding.Encoder) => void) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, type);
    write(encoder);
    return encoding.toUint8Array(encoder);
  }

  private send(message: Uint8Array) {
    if (this.ws?.readyState === this.opts.WebSocket.OPEN) this.ws.send(message as Uint8Array<ArrayBuffer>);
  }

  private setStatus(status: Status) {
    this.status = status;
    this.onStatus(status);
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
