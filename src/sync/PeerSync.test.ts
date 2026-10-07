import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { describe, expect, it } from "vitest";
import { PeerSync, awarenessEntries, type Channel } from "./PeerSync";

/** Two in-memory data channels wired to each other, already open. */
function channelPair(): [Channel, Channel] {
  const make = (): Channel & { peer?: Channel } => ({
    readyState: "open",
    binaryType: "blob",
    onopen: null,
    onmessage: null,
    onclose: null,
    send(data) {
      const copy = data.slice();
      queueMicrotask(() => this.peer?.onmessage?.({ data: copy }));
    },
  });
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function node() {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  return { doc, awareness, sync: new PeerSync(doc, awareness) };
}

describe("PeerSync", () => {
  it("syncs over channels that are already open, and tracks cursors", async () => {
    const a = node();
    const b = node();
    a.doc.getText("t").insert(0, "before");
    a.awareness.setLocalStateField("user", "otter");
    const [ab, ba] = channelPair();
    a.sync.attach("b", ab);
    b.sync.attach("a", ba);
    await tick();
    expect(b.doc.getText("t").toString()).toBe("before");
    expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ user: "otter" });

    a.awareness.setLocalState(null);
    await tick();
    expect(b.awareness.getStates().has(a.doc.clientID)).toBe(false);
  });

  it("forgets a peer's cursors when its channel closes, ignoring stale channels", async () => {
    const a = node();
    const b = node();
    a.awareness.setLocalStateField("user", "otter");
    const [ab, ba] = channelPair();
    a.sync.attach("b", ab);
    b.sync.attach("a", ba);
    await tick();
    const [, stale] = channelPair();
    b.sync.attach("ghost", stale);
    b.sync.attach("ghost", channelPair()[1]);
    stale.onclose?.();
    expect(b.sync.peerCount).toBe(2);

    ba.onclose?.();
    expect(b.awareness.getStates().has(a.doc.clientID)).toBe(false);
    expect(b.sync.peerCount).toBe(1);
  });

  it("doesn't send on closed channels", async () => {
    const a = node();
    const [ab] = channelPair();
    ab.readyState = "connecting";
    let sent = 0;
    ab.send = () => void sent++;
    a.sync.attach("b", ab);
    a.doc.getText("t").insert(0, "x");
    expect(sent).toBe(0);
    a.sync.destroy();
  });

  it("reads awareness entries", () => {
    const a = node();
    a.awareness.setLocalStateField("user", 1);
    const entries = awarenessEntries(encodeAwarenessUpdate(a.awareness, [a.doc.clientID]));
    expect(entries).toEqual([{ id: a.doc.clientID, removed: false }]);
  });
});
