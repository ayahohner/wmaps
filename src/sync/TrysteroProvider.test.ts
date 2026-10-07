import * as Y from "yjs";
import { describe, it, expect } from "vitest";

import { TrysteroProvider } from "./TrysteroProvider";

/**
 * In-memory stand-in for Trystero: every joinRoom() call on the same roomId
 * sees the others, and action messages are delivered asynchronously like a
 * real data channel.
 */
function createFakeNetwork() {
  type Peer = {
    id: string;
    room: any;
    onMessage: ((data: Uint8Array, ctx: { peerId: string }) => void) | null;
  };
  const rooms = new Map<string, Peer[]>();
  const sent = { count: 0 };
  let n = 0;

  const joinRoom = (roomId: string, selfId: string = `peer-${n++}`) => {
    const peers = rooms.get(roomId) ?? [];
    rooms.set(roomId, peers);
    const self: Peer = { id: selfId, room: null, onMessage: null };

    const room = {
      onPeerJoin: null as null | ((id: string) => void),
      onPeerLeave: null as null | ((id: string) => void),
      getPeers: () =>
        Object.fromEntries(
          peers.filter((p) => p !== self).map((p) => [p.id, {}])
        ),
      makeAction: () => ({
        set onMessage(fn: Peer["onMessage"]) {
          self.onMessage = fn;
        },
        get onMessage() {
          return self.onMessage;
        },
        send: async (data: Uint8Array, opts?: { target?: string | string[] }) => {
          sent.count++;
          const targets = opts?.target == null ? null : [opts.target].flat();
          for (const p of peers) {
            if (p === self) continue;
            if (targets && !targets.includes(p.id)) continue;
            const copy = data.slice();
            queueMicrotask(() => p.onMessage?.(copy, { peerId: self.id }));
          }
        },
      }),
      leave: async () => {
        const i = peers.indexOf(self);
        if (i >= 0) peers.splice(i, 1);
        for (const p of peers) p.room.onPeerLeave?.(self.id);
      },
    };
    self.room = room;

    // Announce after the provider has wired up its handlers.
    queueMicrotask(() => {
      for (const p of peers) {
        p.room.onPeerJoin?.(self.id);
        room.onPeerJoin?.(p.id);
      }
      peers.push(self);
    });
    return room as any;
  };

  return { joinRoom, sent };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

function provider(doc: Y.Doc, room: any) {
  return new TrysteroProvider(doc, room);
}
describe("TrysteroProvider", () => {
  it("syncs existing and new edits between two peers", async () => {
    const net = createFakeNetwork();
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("t").insert(0, "hello");

    const pa = provider(a, net.joinRoom("room"));
    const pb = provider(b, net.joinRoom("room"));
    await flush();
    expect(b.getText("t").toString()).toBe("hello");

    b.getText("t").insert(5, " world");
    await flush();
    expect(a.getText("t").toString()).toBe("hello world");

    pa.destroy();
    pb.destroy();
  });

  it("shares awareness and clears it when a peer leaves", async () => {
    const net = createFakeNetwork();
    const a = new Y.Doc();
    const b = new Y.Doc();
    const pa = provider(a, net.joinRoom("room"));
    const pb = provider(b, net.joinRoom("room"));

    pb.awareness.setLocalStateField("user", { name: "otter" });
    await flush();
    expect(pa.awareness.getStates().get(b.clientID)).toEqual({
      user: { name: "otter" },
    });

    pb.destroy();
    await flush();
    expect(pa.awareness.getStates().has(b.clientID)).toBe(false);
    pa.destroy();
  });

  it("does not leak across rooms", async () => {
    const net = createFakeNetwork();
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("t").insert(0, "secret");
    const pa = provider(a, net.joinRoom("room-1"));
    const pb = provider(b, net.joinRoom("room-2"));
    await flush();
    expect(b.getText("t").toString()).toBe("");
    pa.destroy();
    pb.destroy();
  });

  it("sends each edit once and nothing when alone", async () => {
    const net = createFakeNetwork();
    const a = new Y.Doc();
    const pa = provider(a, net.joinRoom("room"));
    await flush();
    a.getText("t").insert(0, "solo");
    await flush();
    expect(net.sent.count).toBe(0);

    const b = new Y.Doc();
    const pb = provider(b, net.joinRoom("room"));
    await flush();
    net.sent.count = 0;
    a.getText("t").insert(0, "x");
    await flush();
    expect(net.sent.count).toBe(1);
    expect(b.getText("t").toString()).toBe("xsolo");
    pa.destroy();
    pb.destroy();
  });
});
