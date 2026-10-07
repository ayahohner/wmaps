// @vitest-environment node
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { afterEach, describe, expect, it } from "vitest";
import { YRoom, type Conn } from "../../relay/src/room";
import { SyncProvider, type SyncProviderOptions } from "./SyncProvider";

/** In-memory stand-in for the relay: real YRoom, fake sockets, async delivery. */
function createRelay() {
  const sockets = new Set<FakeSocket>();
  const room = new YRoom(() => [...sockets].map((s) => s.conn));
  const relay = { room, sockets, answerPings: true, pings: 0 };

  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    binaryType = "blob";
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: ArrayBuffer | string }) => void) | null = null;
    onclose: (() => void) | null = null;
    private clients: Record<number, number> = {};
    readonly conn: Conn = {
      send: (data) => this.deliver(data.slice().buffer),
      clients: () => this.clients,
      setClients: (c) => (this.clients = c),
    };

    constructor(readonly url: string) {
      setTimeout(() => {
        this.readyState = FakeSocket.OPEN;
        sockets.add(this);
        room.join(this.conn);
        this.onopen?.();
      });
    }

    send(data: Uint8Array | string) {
      if (data === "ping") return this.ping();
      const copy = (data as Uint8Array).slice();
      setTimeout(() => sockets.has(this) && room.receive(this.conn, copy));
    }

    close() {
      if (!sockets.delete(this)) return;
      this.readyState = 3;
      room.leave(this.conn);
      setTimeout(() => this.onclose?.());
    }

    private ping() {
      relay.pings++;
      if (relay.answerPings) this.deliver("pong");
    }

    private deliver(data: ArrayBuffer | string) {
      setTimeout(() => sockets.has(this) && this.onmessage?.({ data }));
    }
  }

  return { ...relay, relay, WebSocket: FakeSocket as unknown as typeof WebSocket };
}

const providers: SyncProvider[] = [];
afterEach(() => providers.splice(0).forEach((p) => p.destroy()));

function client(net: ReturnType<typeof createRelay>, opts: SyncProviderOptions = {}) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const provider = new SyncProvider("ws://relay/sync/x", doc, awareness, {
    WebSocket: net.WebSocket,
    ...opts,
  });
  providers.push(provider);
  return { doc, awareness, provider, text: doc.getText("t") };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
};

describe("SyncProvider", () => {
  it("syncs edits both ways through the relay", async () => {
    const net = createRelay();
    const a = client(net);
    const b = client(net);
    await until(() => a.provider.synced && b.provider.synced);
    a.text.insert(0, "hello");
    await until(() => b.text.toString() === "hello");
    b.text.insert(5, " world");
    await until(() => a.text.toString() === "hello world");
    expect(a.provider.status).toBe("connected");
  });

  it("gives a late joiner the relay's copy after everyone left", async () => {
    const net = createRelay();
    const a = client(net);
    a.text.insert(0, "kept");
    await until(() => net.room.doc.getText("t").toString() === "kept");
    a.provider.destroy();
    const b = client(net);
    await until(() => b.text.toString() === "kept");
  });

  it("shares cursors and drops them when a peer leaves", async () => {
    const net = createRelay();
    const a = client(net);
    a.awareness.setLocalStateField("user", { name: "otter" });
    await until(() => a.provider.synced);
    const b = client(net);
    await until(() => b.awareness.getStates().get(a.doc.clientID)?.user?.name === "otter");
    a.provider.destroy();
    await until(() => !b.awareness.getStates().has(a.doc.clientID));
  });

  it("reconnects and sends edits made while offline", async () => {
    const net = createRelay();
    const a = client(net, { maxBackoffMs: 10 });
    const b = client(net);
    await until(() => a.provider.synced && b.provider.synced);
    const statuses: string[] = [];
    a.provider.onStatus = (s) => statuses.push(s);
    [...net.sockets][0].close(); // the relay drops a
    a.text.insert(0, "offline");
    await until(() => b.text.toString() === "offline");
    expect(statuses).toContain("disconnected");
  });

  it("pings, and reconnects when the relay goes silent", async () => {
    const net = createRelay();
    const a = client(net, { pingIntervalMs: 10, silenceTimeoutMs: 40, maxBackoffMs: 10 });
    await until(() => net.relay.pings > 0);
    net.relay.answerPings = false;
    const statuses: string[] = [];
    a.provider.onStatus = (s) => statuses.push(s);
    await until(() => statuses.includes("disconnected"));
    await until(() => a.provider.status === "connected");
  });
});
