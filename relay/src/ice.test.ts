import { describe, expect, it, vi } from "vitest";
import { STUN, iceServers } from "./ice";

const env = { TURN_KEY_ID: "k", TURN_KEY_API_TOKEN: "t" };

describe("iceServers", () => {
  it("returns STUN alone without TURN secrets", async () => {
    expect(await iceServers({})).toEqual([STUN]);
  });

  it("returns Cloudflare TURN credentials minus port 53", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ iceServers: [{ urls: ["turn:a:3478", "turn:a:53?transport=udp", "turn:a:53"], username: "u", credential: "c" }] })
    );
    expect(await iceServers(env, fetcher as any)).toEqual([{ urls: ["turn:a:3478"], username: "u", credential: "c" }]);
    expect(fetcher.mock.calls[0][0]).toContain("/turn/keys/k/");
  });

  it("falls back to STUN when the TURN API fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = async () => new Response("no", { status: 500 });
    expect(await iceServers(env, fetcher as any)).toEqual([STUN]);
  });
});
