// @vitest-environment node
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { describe, expect, it } from "vitest";
import { connectSync, roomUrl } from "./connect";

describe("roomUrl", () => {
  it("hashes the map id into a WebSocket URL", async () => {
    const url = await roomUrl("https://relay.example/", "my-map");
    expect(url).toMatch(/^wss:\/\/relay\.example\/sync\/[a-f0-9]{32}$/);
    expect(url).not.toContain("my-map");
    expect(await roomUrl("http://localhost:8787", "my-map")).toBe(
      url.replace("wss://relay.example", "ws://localhost:8787")
    );
  });
});

describe("connectSync", () => {
  it("opens a provider on the map's room", async () => {
    const opened: string[] = [];
    globalThis.WebSocket = class {
      static OPEN = 1;
      constructor(url: string) {
        opened.push(url);
      }
      close() {}
    } as unknown as typeof WebSocket;
    const doc = new Y.Doc();
    const provider = await connectSync(doc, new Awareness(doc), "m", "https://relay.example");
    expect(opened).toEqual([await roomUrl("https://relay.example", "m")]);
    provider.destroy();
  });
});
