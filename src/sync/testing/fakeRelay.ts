import { MapStore } from "../../../relay/src/store";
import { Signaling, type SignalPeer } from "../../../relay/src/signaling";

/**
 * In-memory stand-in for the relay's Durable Object: the real Signaling and
 * MapStore behind fake WebSockets with async delivery.
 */
export function createFakeRelay() {
  const sockets = new Set<FakeSocket>();
  const store = new MapStore();
  const signaling = new Signaling(() => [...sockets].map((s) => s.peer));
  const state = { answerPings: true, pings: 0, opened: [] as string[] };
  let nextId = 0;

  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    binaryType = "blob";
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: ArrayBuffer | string }) => void) | null = null;
    onclose: (() => void) | null = null;
    readonly peer: SignalPeer & { send(data: Uint8Array): void };

    constructor(readonly url: string) {
      state.opened.push(url);
      this.peer = {
        id: `peer-${nextId++}`,
        sendText: (text) => this.deliver(text),
        send: (data) => this.deliver(data.slice().buffer),
      };
      setTimeout(() => this.open());
    }

    send(data: Uint8Array | string) {
      if (data === "ping") return this.ping();
      setTimeout(() => this.receive(typeof data === "string" ? data : data.slice()));
    }

    close() {
      if (!sockets.delete(this)) return;
      this.readyState = 3;
      signaling.leave(this.peer);
      setTimeout(() => this.onclose?.());
    }

    private open() {
      this.readyState = FakeSocket.OPEN;
      sockets.add(this);
      this.onopen?.();
      signaling.join(this.peer);
      store.join(this.peer);
    }

    private receive(data: string | Uint8Array) {
      if (!sockets.has(this)) return;
      if (typeof data === "string") signaling.receive(this.peer, data);
      else store.receive(this.peer, data);
    }

    private ping() {
      state.pings++;
      if (state.answerPings) this.deliver("pong");
    }

    private deliver(data: ArrayBuffer | string) {
      setTimeout(() => sockets.has(this) && this.onmessage?.({ data }));
    }
  }

  return { store, sockets, state, WebSocket: FakeSocket as unknown as typeof WebSocket };
}

export const until = async (check: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!check() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("condition not met in time");
};
