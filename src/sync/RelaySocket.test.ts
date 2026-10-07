// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { RelaySocket, type RelayHandlers } from "./RelaySocket";
import { createFakeRelay, until } from "./testing/fakeRelay";

const sockets: RelaySocket[] = [];
afterEach(() => sockets.splice(0).forEach((s) => s.destroy()));

function open(relay: ReturnType<typeof createFakeRelay>, opts = {}) {
  const seen = { opens: 0, texts: [] as unknown[], binaries: 0 };
  const handlers: RelayHandlers = {
    onOpen: () => seen.opens++,
    onText: (m) => seen.texts.push(m),
    onBinary: () => seen.binaries++,
  };
  const socket = new RelaySocket("ws://relay/sync/x", handlers, { WebSocket: relay.WebSocket, ...opts });
  sockets.push(socket);
  return { socket, seen };
}

describe("RelaySocket", () => {
  it("delivers JSON and binary frames and sends both", async () => {
    const relay = createFakeRelay();
    const { socket, seen } = open(relay);
    await until(() => seen.texts.length === 1 && seen.binaries === 1);
    expect(seen.texts[0]).toMatchObject({ type: "welcome", peers: [] });
    socket.sendJSON({ type: "signal", to: "nobody", data: {} });
    socket.sendBinary(new Uint8Array([0, 0, 0]));
    expect(socket.connected).toBe(true);
  });

  it("reconnects with backoff after the relay drops it", async () => {
    const relay = createFakeRelay();
    const { seen } = open(relay, { maxBackoffMs: 5 });
    await until(() => seen.opens === 1);
    [...relay.sockets][0].close();
    await until(() => seen.opens === 2);
  });

  it("pings, ignores pongs, and reconnects when the relay goes silent", async () => {
    const relay = createFakeRelay();
    const { seen } = open(relay, { pingIntervalMs: 10, silenceTimeoutMs: 40, maxBackoffMs: 5 });
    await until(() => relay.state.pings > 1);
    expect(seen.texts.every((m) => m !== "pong")).toBe(true);
    relay.state.answerPings = false;
    await until(() => seen.opens === 2, 2000);
  });

  it("stays closed after destroy", async () => {
    const relay = createFakeRelay();
    const { socket, seen } = open(relay, { maxBackoffMs: 5 });
    await until(() => seen.opens === 1);
    socket.destroy();
    socket.sendJSON({ ignored: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.opens).toBe(1);
    expect(socket.connected).toBe(false);
  });
});
