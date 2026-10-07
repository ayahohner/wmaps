import { describe, expect, it } from "vitest";
import { Signaling, parseSignal, type SignalPeer } from "./signaling";

const peer = (id: string) => {
  const inbox: any[] = [];
  return { id, inbox, sendText: (t: string) => void inbox.push(JSON.parse(t)) } satisfies SignalPeer & { inbox: any[] };
};

describe("Signaling", () => {
  it("welcomes newcomers with the peer list and announces them", () => {
    const a = peer("a");
    const b = peer("b");
    const signaling = new Signaling(() => [a, b]);
    signaling.join(b);
    expect(b.inbox).toEqual([{ type: "welcome", id: "b", peers: ["a"] }]);
    expect(a.inbox).toEqual([{ type: "peer-joined", id: "b" }]);
    signaling.leave(b);
    expect(a.inbox[1]).toEqual({ type: "peer-left", id: "b" });
  });

  it("forwards signals only to the named peer", () => {
    const a = peer("a");
    const b = peer("b");
    const signaling = new Signaling(() => [a, b]);
    signaling.receive(a, JSON.stringify({ type: "signal", to: "b", data: { sdp: 1 } }));
    signaling.receive(a, JSON.stringify({ type: "signal", to: "a", data: {} }));
    signaling.receive(a, JSON.stringify({ type: "signal", to: "zed", data: {} }));
    signaling.receive(a, "not json");
    expect(b.inbox).toEqual([{ type: "signal", from: "a", data: { sdp: 1 } }]);
    expect(a.inbox).toEqual([]);
  });

  it("parses only well-formed signals", () => {
    expect(parseSignal('{"type":"signal","to":"x","data":1}')).toMatchObject({ to: "x" });
    expect(parseSignal('{"type":"signal","to":3}')).toBeNull();
    expect(parseSignal("null")).toBeNull();
    expect(parseSignal("{")).toBeNull();
  });
});
