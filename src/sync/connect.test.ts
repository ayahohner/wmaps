// @vitest-environment node
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { RTCPeerConnection } from "werift";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapSync, connectSync, fetchIceServers, roomUrl } from "./connect";
import { createFakeRelay, until } from "./testing/fakeRelay";

const syncs: MapSync[] = [];
afterEach(() => syncs.splice(0).forEach((s) => s.destroy()));

function client(relay: ReturnType<typeof createFakeRelay>) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const sync = new MapSync("ws://relay/sync/x", doc, awareness, [], {
    WebSocket: relay.WebSocket,
    RTCPeerConnection: RTCPeerConnection as unknown as typeof globalThis.RTCPeerConnection,
  });
  syncs.push(sync);
  return { doc, awareness, sync, text: doc.getText("t") };
}

describe("MapSync", () => {
  it("syncs edits and cursors peer to peer over WebRTC", async () => {
    const relay = createFakeRelay();
    const a = client(relay);
    a.awareness.setLocalStateField("user", { name: "otter" });
    const b = client(relay);
    await until(() => a.sync.peers.peerCount === 1 && b.sync.peers.peerCount === 1, 15000);
    a.text.insert(0, "hello");
    await until(() => b.text.toString() === "hello");
    await until(() => b.awareness.getStates().get(a.doc.clientID)?.user?.name === "otter");

    a.awareness.setLocalStateField("mapPointer", { x: 25, y: 70 });
    await until(() => b.awareness.getStates().get(a.doc.clientID)?.mapPointer?.x === 25);
    a.awareness.setLocalStateField("mapPointer", null);
    await until(() => b.awareness.getStates().get(a.doc.clientID)?.mapPointer === null);

    a.sync.destroy();
    await until(() => !b.awareness.getStates().has(a.doc.clientID), 15000);
  }, 30000);

  it("saves to and loads from the Durable Object", async () => {
    const relay = createFakeRelay();
    const a = client(relay);
    await until(() => a.sync.storage.loaded);
    a.text.insert(0, "saved");
    await until(() => relay.store.doc.getText("t").toString() === "saved");
    a.sync.destroy();

    const b = client(relay);
    await until(() => b.sync.storage.loaded && b.text.toString() === "saved");
  });

  it("sends big docs to peers in chunks", async () => {
    const relay = createFakeRelay();
    relay.store.join = relay.store.receive = () => {}; // peers only
    const a = client(relay);
    a.text.insert(0, "x".repeat(100_000));
    const b = client(relay);
    await until(() => b.text.length === 100_000, 15000);
    expect(relay.store.doc.getText("t").length).toBe(0);
  }, 30000);
});

describe("connectSync", () => {
  it("uses the browser's WebSocket by default", async () => {
    const relay = createFakeRelay();
    vi.stubGlobal("WebSocket", relay.WebSocket);
    try {
      const doc = new Y.Doc();
      const fetcher = async () => Response.json({ iceServers: [] });
      syncs.push(await connectSync(doc, new Awareness(doc), "m", { fetch: fetcher as any }));
      await until(() => relay.sockets.size === 1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hashes the map id into the room URL", async () => {
    const url = await roomUrl("https://relay.example/", "my-map");
    expect(url).toMatch(/^wss:\/\/relay\.example\/sync\/[a-f0-9]{32}$/);
    expect(url).not.toContain("my-map");
  });

  it("uses the relay's ICE servers, or STUN when that fails", async () => {
    const turn = [{ urls: "turn:t", username: "u", credential: "c" }];
    const ok = vi.fn(async () => Response.json({ iceServers: turn }));
    expect(await fetchIceServers("https://r/", ok as any)).toEqual(turn);
    expect(ok).toHaveBeenCalledWith("https://r/ice");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = async () => new Response("", { status: 500 });
    expect((await fetchIceServers("https://r", down as any))[0].urls).toEqual(["stun:stun.cloudflare.com:3478"]);
  });

  it("opens the relay socket for the map", async () => {
    const relay = createFakeRelay();
    const doc = new Y.Doc();
    const fetcher = async () => Response.json({ iceServers: [] });
    const sync = await connectSync(doc, new Awareness(doc), "m", {
      relayUrl: "https://relay.example",
      WebSocket: relay.WebSocket,
      fetch: fetcher as any,
    });
    syncs.push(sync);
    expect(relay.state.opened).toEqual([await roomUrl("https://relay.example", "m")]);
  });
});
