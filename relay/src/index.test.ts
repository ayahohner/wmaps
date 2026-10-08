// @vitest-environment node
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown, readonly env: unknown) {}
  },
}));

/** Minimal stand-ins for the Workers runtime. */
class FakeSocket {
  sent: any[] = [];
  closed = false;
  private attachment: unknown = null;
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  serializeAttachment(value: unknown) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

class FakeResponse {
  constructor(readonly body: unknown, readonly init: { status?: number; headers?: Record<string, string> } = {}) {}
  get status() {
    return this.init.status ?? 200;
  }
  static json(body: unknown, init?: FakeResponse["init"]) {
    return new FakeResponse(body, init);
  }
}

function fakeState(saved?: Uint8Array) {
  const sockets: FakeSocket[] = [];
  const storage = new Map<string, unknown>(saved ? [["doc", saved]] : []);
  const alarms: number[] = [];
  return {
    sockets,
    storage,
    alarms,
    ctx: {
      setWebSocketAutoResponse: vi.fn(),
      getWebSockets: () => sockets,
      acceptWebSocket: (ws: FakeSocket) => sockets.push(ws),
      blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
      storage: {
        get: async (key: string) => storage.get(key),
        put: async (key: string, value: unknown) => void storage.set(key, value),
        setAlarm: async (at: number) => void alarms.push(at),
      },
    },
  };
}

function updateFrame(text: string) {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 0);
  syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc));
  return encoding.toUint8Array(e).buffer;
}

beforeEach(() => {
  vi.stubGlobal("Response", FakeResponse);
  vi.stubGlobal("WebSocketRequestResponsePair", class {});
  vi.stubGlobal("crypto", { randomUUID: () => `peer-${Math.random()}` });
  vi.stubGlobal("WebSocketPair", class {
    0 = new FakeSocket();
    1 = new FakeSocket();
  });
});

const ROOM = "0123456789abcdef0123456789abcdef";
const env = (fetch = vi.fn(async () => new FakeResponse(null, { status: 101 }))) => ({
  ALLOWED_ORIGINS: "https://maptogether.io",
  MAP_ROOM: { idFromName: (name: string) => name, get: () => ({ fetch }) },
});
const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://relay.test${path}`, { headers });

describe("worker fetch", async () => {
  const { default: worker } = await import("./index");
  const ok = { Origin: "https://maptogether.io", Upgrade: "websocket" };

  it("routes valid room upgrades to the room's Durable Object", async () => {
    const e = env();
    const res = await worker.fetch(request(`/sync/${ROOM}`, ok) as any, e as any);
    expect(res.status).toBe(101);
  });

  it("refuses bad paths, origins and non-WebSocket requests", async () => {
    const statusOf = async (path: string, headers: Record<string, string>) =>
      (await worker.fetch(request(path, headers) as any, env() as any)).status;
    expect(await statusOf("/sync/nope", ok)).toBe(404);
    expect(await statusOf("/ice", { Origin: "https://evil.com" })).toBe(403);
    expect(await statusOf(`/sync/${ROOM}`, { ...ok, Origin: "https://evil.com" })).toBe(403);
    expect(await statusOf(`/sync/${ROOM}`, { Origin: ok.Origin })).toBe(426);
  });
});

describe("worker /ice", async () => {
  const { default: worker } = await import("./index");
  it("returns STUN without TURN secrets, private to the origin", async () => {
    const res = (await worker.fetch(request("/ice", { Origin: "https://maptogether.io" }) as any, env() as any)) as unknown as FakeResponse;
    expect(res.body).toEqual({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }] });
    expect(res.init.headers).toMatchObject({ "Access-Control-Allow-Origin": "https://maptogether.io" });
  });
});

describe("MapRoom", async () => {
  const { MapRoom } = await import("./index");

  it("loads the saved doc, accepts sockets, relays and saves edits", async () => {
    const seed = new Y.Doc();
    seed.getText("t").insert(0, "saved ");
    const state = fakeState(Y.encodeStateAsUpdate(seed));
    const room = new MapRoom(state.ctx as any, env() as any);
    await Promise.resolve();

    const res = (await room.fetch()) as unknown as FakeResponse;
    expect(res.status).toBe(101);
    await room.fetch();
    const [a, b] = state.sockets;
    const welcome = JSON.parse(b.sent[0]);
    expect(welcome).toMatchObject({ type: "welcome", peers: [JSON.parse(a.sent[0]).id] });

    await room.webSocketMessage(a as any, updateFrame("edit"));
    await room.webSocketMessage(a as any, new ArrayBuffer(2 * 1024 * 1024));
    await room.webSocketMessage(a as any, JSON.stringify({ type: "signal", to: welcome.id, data: { sdp: 1 } }));
    await room.webSocketMessage(a as any, "x".repeat(65 * 1024));
    expect(b.sent.filter((m) => typeof m === "string").map((m) => JSON.parse(m).type)).toEqual(["welcome", "signal"]);
    expect(state.alarms).toHaveLength(1);

    await room.alarm();
    const saved = new Y.Doc();
    Y.applyUpdate(saved, state.storage.get("doc") as Uint8Array);
    expect(saved.getText("t").toString()).toContain("saved");
    expect(saved.getText("t").toString()).toContain("edit");
  });

  it("saves when the last socket closes, and refuses a full room", async () => {
    const state = fakeState();
    const room = new MapRoom(state.ctx as any, env() as any);
    await room.fetch();
    const [a] = state.sockets;
    await room.webSocketMessage(a as any, updateFrame("x"));
    await room.webSocketError(a as any);
    expect(a.closed).toBe(true);
    expect(state.storage.has("doc")).toBe(true);

    state.sockets.push(...Array.from({ length: 64 }, () => new FakeSocket()));
    expect(((await room.fetch()) as unknown as FakeResponse).status).toBe(429);
  });

  it("acknowledges only after storage commits and reports write failures", async () => {
    const state = fakeState();
    const room = new MapRoom(state.ctx as any, env() as any);
    await room.fetch();
    const socket = state.sockets[0];
    await room.webSocketMessage(socket as any, updateFrame("checkpoint"));
    let finish!: () => void;
    state.ctx.storage.put = () => new Promise<void>((resolve) => { finish = resolve; });
    const request = room.webSocketMessage(socket as any, JSON.stringify({ type: "save", id: 7 }));
    await Promise.resolve();
    expect(socket.sent.some((m) => typeof m === "string" && m.includes('"saved"'))).toBe(false);
    finish();
    await request;
    expect(JSON.parse(socket.sent.at(-1))).toEqual({ type: "saved", id: 7 });
    state.ctx.storage.put = async () => { throw new Error("disk unavailable"); };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await room.webSocketMessage(socket as any, JSON.stringify({ type: "save", id: 8 }));
    expect(JSON.parse(socket.sent.at(-1))).toEqual({ type: "save-error", id: 8 });
    errors.mockRestore();
  });

  it("ignores malformed checkpoint requests without writing or acknowledging", async () => {
    const state = fakeState();
    const room = new MapRoom(state.ctx as any, env() as any);
    await room.fetch();
    const socket = state.sockets[0];
    const before = socket.sent.length;
    await room.webSocketMessage(socket as any, "not json");
    await room.webSocketMessage(socket as any, JSON.stringify({ type: "save", id: -1 }));
    await room.webSocketMessage(socket as any, JSON.stringify({ type: "save", id: "bad" }));
    expect(socket.sent).toHaveLength(before);
    expect(state.storage.size).toBe(0);
  });

  it("never confirms a rejected oversized upload", async () => {
    const state = fakeState();
    const room = new MapRoom(state.ctx as any, env() as any);
    await room.fetch();
    const socket = state.sockets[0];
    await room.webSocketMessage(socket as any, new ArrayBuffer(2 * 1024 * 1024));
    expect(socket.closed).toBe(true);
    await room.webSocketMessage(socket as any, JSON.stringify({ type: "save", id: 1 }));
    expect(JSON.parse(socket.sent.at(-1))).toEqual({ type: "save-error", id: 1 });
  });

  it("skips saving a doc over the storage limit", async () => {
    const state = fakeState();
    const room = new MapRoom(state.ctx as any, env() as any);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await room.fetch();
    const big = "x".repeat(1024 * 1024 - 64);
    for (let i = 0; i < 3; i++) await room.webSocketMessage(state.sockets[0] as any, updateFrame(big));
    await room.alarm();
    expect(state.storage.has("doc")).toBe(false);
    expect(errors).toHaveBeenCalled();
  });
});
