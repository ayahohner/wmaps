import { createTopicStrategy } from "@trystero-p2p/core";
import type { BaseRoomConfig, StrategyMessage } from "@trystero-p2p/core";

/**
 * Trystero signaling strategy for our own Cloudflare relay (see /relay).
 *
 * The relay is a dumb pub/sub over WebSocket, one Durable Object per map:
 *   client -> {type: "subscribe" | "unsubscribe", topic}
 *   client -> {type: "publish", topic, payload}
 *   relay  -> {topic, payload}
 * It only carries WebRTC handshakes (encrypted by Trystero with the room
 * password); document data flows peer to peer.
 *
 * Note: Trystero calls init() once per strategy, so a tab can only be in one
 * relay room at a time. That matches the app (one map per tab).
 */

export type CloudflareRoomConfig = BaseRoomConfig & {
  relayConfig: { urls: string[] };
};

type Handler = (topic: string, msg: StrategyMessage) => void;

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

/** A WebSocket that reconnects and replays subscriptions. */
class RelaySocket {
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly queue: string[] = [];
  private backoff = 1_000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  readonly ready: Promise<RelaySocket>;
  private resolveReady!: (s: RelaySocket) => void;

  private readonly url: string;

  constructor(url: string) {
    this.url = url;
    this.ready = new Promise((r) => (this.resolveReady = r));
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.backoff = 1_000;
      for (const topic of this.handlers.keys()) {
        ws.send(JSON.stringify({ type: "subscribe", topic }));
      }
      while (this.queue.length) ws.send(this.queue.shift()!);
      this.pingTimer = setInterval(() => ws.send("ping"), PING_MS);
      this.resolveReady(this);
    });

    ws.addEventListener("message", (event) => {
      if (event.data === "pong") return;
      let msg: { topic?: string; payload?: StrategyMessage };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!msg.topic || msg.payload === undefined) return;
      this.handlers.get(msg.topic)?.forEach((h) => h(msg.topic!, msg.payload!));
    });

    ws.addEventListener("close", () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      if (this.closed) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    });
  }

  private raw(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
    else this.queue.push(data);
  }

  subscribe(topic: string, handler: Handler): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
      this.raw(JSON.stringify({ type: "subscribe", topic }));
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) {
        this.handlers.delete(topic);
        this.raw(JSON.stringify({ type: "unsubscribe", topic }));
      }
    };
  }

  publish(topic: string, payload: StrategyMessage) {
    this.raw(JSON.stringify({ type: "publish", topic, payload }));
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

const sockets = new Map<string, RelaySocket>();

export const joinCloudflareRoom = createTopicStrategy<
  RelaySocket,
  CloudflareRoomConfig
>({
  init: (config) =>
    config.relayConfig.urls.map((url) => {
      let s = sockets.get(url);
      if (!s) {
        s = new RelaySocket(url);
        sockets.set(url, s);
      }
      return s.ready;
    }),
  subscribeTopic: (socket, topic, onMessage) =>
    socket.subscribe(topic, onMessage),
  publishTopic: (socket, topic, msg) => socket.publish(topic, msg),
});
