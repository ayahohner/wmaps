import { DurableObject } from "cloudflare:workers";
import { isAllowedOrigin } from "./origins";
import { iceServers } from "./ice";
import { MapStore } from "./store";
import { Signaling } from "./signaling";
import type { IceEnv } from "./ice";
import type { SignalPeer } from "./signaling";
import type { StoreConn } from "./store";

/**
 * wmaps relay.
 *
 *   GET /ice         ICE servers (STUN + short-lived TURN) for RTCPeerConnection
 *   GET /sync/:room  WebSocket into the map's Durable Object: JSON text frames
 *                    are WebRTC signaling, binary frames are the Yjs sync
 *                    protocol against the saved map (load and save).
 */

export interface Env extends IceEnv {
  MAP_ROOM: DurableObjectNamespace<MapRoom>;
  ALLOWED_ORIGINS: string;
}

const ROOM_PATH = /^\/sync\/([a-f0-9]{32})$/;
const MAX_SOCKETS = 64;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_BINARY_BYTES = 1024 * 1024;
/** SQLite-backed Durable Object values are capped at 2 MB. */
const MAX_DOC_BYTES = 2 * 1024 * 1024 - 1024;
const SAVE_DELAY_MS = 2_000;
const DOC_KEY = "doc";

type Conn = SignalPeer & StoreConn;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    if (!isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/ice") return iceResponse(env, origin!);
    return syncRoom(req, env, url.pathname.match(ROOM_PATH)?.[1]);
  },
} satisfies ExportedHandler<Env>;

async function iceResponse(env: Env, origin: string): Promise<Response> {
  return Response.json(
    { iceServers: await iceServers(env) },
    // Credentials are per visitor: never cache them in shared caches.
    { headers: { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Cache-Control": "private, max-age=600" } }
  );
}

function syncRoom(req: Request, env: Env, room: string | undefined): Promise<Response> | Response {
  if (!room) return new Response("Not found", { status: 404 });
  if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }
  return env.MAP_ROOM.get(env.MAP_ROOM.idFromName(room)).fetch(req);
}

export class MapRoom extends DurableObject<Env> {
  private readonly store: MapStore;
  private readonly signaling: Signaling;
  private readonly conns = new WeakMap<WebSocket, Conn>();
  private savePending = false;
  private saving: Promise<boolean> = Promise.resolve(true);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime, so keepalives don't wake a hibernating room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.store = new MapStore(() => this.scheduleSave());
    this.signaling = new Signaling(() => ctx.getWebSockets().map((ws) => this.conn(ws)));
    void ctx.blockConcurrencyWhile(async () => this.store.load(await ctx.storage.get<Uint8Array>(DOC_KEY)));
  }

  async fetch(): Promise<Response> {
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response("Room full", { status: 429 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID() });
    const conn = this.conn(server);
    this.signaling.join(conn);
    this.store.join(conn);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string") await this.receiveText(ws, message);
    else if (message.byteLength <= MAX_BINARY_BYTES) this.store.receive(this.conn(ws), new Uint8Array(message));
    else {
      ws.serializeAttachment({ ...ws.deserializeAttachment(), uploadRejected: true });
      ws.close(1009, "Map update exceeds upload limit");
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.signaling.leave(this.conn(ws));
    ws.close();
    if (this.ctx.getWebSockets().length <= 1) await this.save();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    await this.save();
  }

  private async receiveText(ws: WebSocket, text: string) {
    if (text.length > MAX_TEXT_BYTES) return;
    let message;
    try { message = JSON.parse(text); } catch { return; }
    if (message?.type !== "save") {
      this.signaling.receive(this.conn(ws), text);
      return;
    }
    if (!Number.isSafeInteger(message.id) || message.id < 0) return;
    // Ordered socket frames guarantee preceding uploads are in this snapshot.
    const saved = !ws.deserializeAttachment()?.uploadRejected && await this.save();
    ws.send(JSON.stringify({ type: saved ? "saved" : "save-error", id: message.id }));
  }

  private scheduleSave() {
    if (this.savePending) return;
    this.savePending = true;
    void this.ctx.storage.setAlarm(Date.now() + SAVE_DELAY_MS);
  }

  private save() {
    // Serialize writes so an older snapshot can never overwrite a newer one.
    this.saving = this.saving.then(() => this.persist());
    return this.saving;
  }

  private async persist(): Promise<boolean> {
    this.savePending = false;
    const snapshot = this.store.snapshot();
    if (snapshot.byteLength > MAX_DOC_BYTES) {
      console.error(`map too large to save: ${snapshot.byteLength} bytes`);
      return false;
    }
    try {
      await this.ctx.storage.put(DOC_KEY, snapshot);
      return true;
    } catch (error) {
      console.error("map save failed", error);
      this.scheduleSave();
      return false;
    }
  }

  /** One Conn per socket; the peer id lives in the attachment to survive hibernation. */
  private conn(ws: WebSocket): Conn {
    let conn = this.conns.get(ws);
    if (!conn) {
      conn = {
        id: (ws.deserializeAttachment() as { id: string }).id,
        sendText: (text) => ws.send(text),
        send: (data) => ws.send(data),
      };
      this.conns.set(ws, conn);
    }
    return conn;
  }
}
