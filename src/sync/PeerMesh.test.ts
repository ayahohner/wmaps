import { describe, expect, it } from "vitest";
import { PeerMesh } from "./PeerMesh";

/** Records calls; descriptions are applied instantly. */
class FakePC {
  static all: FakePC[] = [];
  remoteDescription: unknown = null;
  localDescription: unknown = null;
  connectionState = "new";
  candidates: unknown[] = [];
  closed = false;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ondatachannel: ((e: { channel: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() {
    FakePC.all.push(this);
  }
  createDataChannel() {
    return { label: "yjs" };
  }
  async createOffer() {
    return { type: "offer", sdp: "o" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "a" };
  }
  async setLocalDescription(d: unknown) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: unknown) {
    this.remoteDescription = d;
  }
  async addIceCandidate(c: unknown) {
    this.candidates.push(c);
  }
  close() {
    this.closed = true;
  }
}

function mesh() {
  FakePC.all = [];
  const signals: [string, any][] = [];
  const channels: string[] = [];
  const m = new PeerMesh((to, data) => signals.push([to, data]), (id) => channels.push(id), {
    iceServers: [],
    RTCPeerConnection: FakePC as unknown as typeof RTCPeerConnection,
  });
  return { m, signals, channels };
}

describe("PeerMesh", () => {
  it("offers to everyone already in the room", async () => {
    const { m, signals, channels } = mesh();
    await m.handle({ type: "welcome", id: "me", peers: ["a", "b"] });
    expect(m.selfId).toBe("me");
    expect(channels).toEqual(["a", "b"]);
    expect(signals.map(([to, d]) => [to, d.sdp.type])).toEqual([["a", "offer"], ["b", "offer"]]);
  });

  it("answers offers, buffering early ICE candidates", async () => {
    const { m, signals, channels } = mesh();
    await m.handle({ type: "signal", from: "x", data: { candidate: { candidate: "early" } } });
    await m.handle({ type: "signal", from: "x", data: { sdp: { type: "offer", sdp: "o" } } });
    await m.handle({ type: "signal", from: "x", data: { candidate: { candidate: "late" } } });
    const [pc] = FakePC.all;
    expect(pc.candidates).toEqual([{ candidate: "early" }, { candidate: "late" }]);
    expect(signals).toEqual([["x", { sdp: { type: "answer", sdp: "a" } }]]);

    pc.onicecandidate!({ candidate: { candidate: "mine" } });
    pc.onicecandidate!({ candidate: null });
    pc.ondatachannel!({ channel: {} });
    expect(signals.at(-1)).toEqual(["x", { candidate: { candidate: "mine" } }]);
    expect(channels).toEqual(["x"]);
  });

  it("ignores answers from strangers and empty signals", async () => {
    const { m } = mesh();
    await m.handle({ type: "signal", from: "x", data: { sdp: { type: "answer", sdp: "a" } } });
    await m.handle({ type: "signal", from: "x", data: {} });
    await m.handle({ type: "peer-joined", id: "y" });
    expect(FakePC.all).toHaveLength(0);
  });

  it("drops failed and departed peers, and resets on a new welcome", async () => {
    const { m } = mesh();
    await m.handle({ type: "welcome", id: "me", peers: ["a", "b", "c"] });
    const [a, b, c] = FakePC.all;
    a.connectionState = "failed";
    a.onconnectionstatechange!();
    b.onconnectionstatechange!();
    await m.handle({ type: "peer-left", id: "b" });
    expect([a.closed, b.closed, c.closed]).toEqual([true, true, false]);
    expect(m.peerIds).toEqual(["c"]);
    await m.handle({ type: "welcome", id: "me2", peers: [] });
    expect(c.closed).toBe(true);
    expect(m.peerIds).toEqual([]);
  });
});
