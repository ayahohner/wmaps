/**
 * WebSocket to the relay with keepalive and reconnects. Text frames are JSON
 * (signaling); binary frames are passed through. "ping"/"pong" keepalives are
 * answered by the relay runtime without waking the room.
 */

export interface RelayHandlers {
  onOpen(): void;
  onText(message: unknown): void;
  onBinary(data: Uint8Array): void;
}

export interface RelaySocketOptions {
  /** Injected for tests and Node. */
  WebSocket?: typeof WebSocket;
  pingIntervalMs?: number;
  /** Reconnect when nothing (not even a pong) arrives for this long. */
  silenceTimeoutMs?: number;
  maxBackoffMs?: number;
}

export class RelaySocket {
  connected = false;
  private ws: WebSocket | null = null;
  private attempts = 0;
  private lastMessageAt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private destroyed = false;
  private readonly opts: Required<RelaySocketOptions>;

  constructor(
    readonly url: string,
    private readonly handlers: RelayHandlers,
    opts: RelaySocketOptions = {}
  ) {
    this.opts = {
      WebSocket: globalThis.WebSocket,
      pingIntervalMs: 20_000,
      silenceTimeoutMs: 45_000,
      maxBackoffMs: 10_000,
      ...opts,
    };
    this.connect();
  }

  sendJSON(message: unknown) {
    this.send(JSON.stringify(message));
  }

  sendBinary(data: Uint8Array) {
    this.send(data as Uint8Array<ArrayBuffer>);
  }

  destroy() {
    this.destroyed = true;
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
  }

  private handleOpen() {
    this.attempts = 0;
    this.connected = true;
    this.lastMessageAt = Date.now();
    this.timers.push(setInterval(() => this.keepAlive(), this.opts.pingIntervalMs));
    this.handlers.onOpen();
  }

  private handleClose(ws: WebSocket) {
    if (ws !== this.ws) return;
    this.ws = null;
    this.connected = false;
    this.clearTimers();
    if (this.destroyed) return;
    const delay = Math.min(this.opts.maxBackoffMs, 250 * 2 ** this.attempts++);
    this.timers.push(setTimeout(() => this.connect(), delay));
  }

  private keepAlive() {
    if (Date.now() - this.lastMessageAt > this.opts.silenceTimeoutMs) this.ws?.close();
    else this.ws?.send("ping");
  }

  private handleMessage(data: ArrayBuffer | string) {
    this.lastMessageAt = Date.now();
    if (typeof data !== "string") this.handlers.onBinary(new Uint8Array(data));
    else if (data !== "pong") this.handlers.onText(JSON.parse(data));
  }

  private send(data: string | Uint8Array<ArrayBuffer>) {
    if (this.ws?.readyState === this.opts.WebSocket.OPEN) this.ws.send(data);
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
