import { DurableObject } from "cloudflare:workers";
import { isAllowedOrigin } from "./origins";
import { YRoom } from "./room";
import type { Conn } from "./room";

/**
 * wmaps relay: GET /sync/:room opens a WebSocket into that map's Durable
 * Object, which holds the Yjs document, relays edits and cursors, and saves
 * the document to its SQLite storage.
 */

export interface Env {
  MAP_ROOM: DurableObjectNamespace<MapRoom>;
  ALLOWED_ORIGINS: string;
}

const ROOM_PATH = /^\/sync\/([a-f0-9]{32})$/;
const MAX_SOCKETS = 64;
const MAX_MESSAGE_BYTES = 1024 * 1024;
/** SQLite-backed Durable Object values are capped at 2 MB. */
const MAX_DOC_BYTES = 2 * 1024 * 1024 - 1024;
const SAVE_DELAY_MS = 2_000;
const DOC_KEY = "doc";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const room = new URL(req.url).pathname.match(ROOM_PATH)?.[1];
    if (!room) return new Response("wmaps relay\n", { status: 404 });
    const refusal = refuse(req, env);
    if (refusal) return refusal;
    return env.MAP_ROOM.get(env.MAP_ROOM.idFromName(room)).fetch(req);
  },
} satisfies ExportedHandler<Env>;

function refuse(req: Request, env: Env): Response | null {
  if (!isAllowedOrigin(req.headers.get("Origin"), env.ALLOWED_ORIGINS)) {
    return new Response("Forbidden", { status: 403 });
  }
  const upgrade = req.headers.get("Upgrade")?.toLowerCase();
  return upgrade === "websocket" ? null : new Response("Expected WebSocket", { status: 426 });
}

export class MapRoom extends DurableObject<Env> {
  private readonly room: YRoom;
  private readonly conns = new WeakMap<WebSocket, Conn>();
  private savePending = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime, so keepalives don't wake a hibernating room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.room = new YRoom(
      () => ctx.getWebSockets().map((ws) => this.conn(ws)),
      () => this.scheduleSave()
    );
    void ctx.blockConcurrencyWhile(async () =>
      this.room.load(await ctx.storage.get<Uint8Array>(DOC_KEY))
    );
  }

  async fetch(): Promise<Response> {
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
      return new Response("Room full", { status: 429 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.room.join(this.conn(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string" || message.byteLength > MAX_MESSAGE_BYTES) return;
    this.room.receive(this.conn(ws), new Uint8Array(message));
  }

  async webSocketClose(ws: WebSocket) {
    this.room.leave(this.conn(ws));
    ws.close();
    if (this.ctx.getWebSockets().length <= 1) await this.save();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    await this.save();
  }

  private scheduleSave() {
    if (this.savePending) return;
    this.savePending = true;
    void this.ctx.storage.setAlarm(Date.now() + SAVE_DELAY_MS);
  }

  private async save() {
    this.savePending = false;
    const snapshot = this.room.snapshot();
    if (snapshot.byteLength > MAX_DOC_BYTES) {
      console.error(`doc too large to save: ${snapshot.byteLength} bytes`);
      return;
    }
    await this.ctx.storage.put(DOC_KEY, snapshot);
  }

  /** Wraps a socket; the client list lives in its attachment to survive hibernation. */
  private conn(ws: WebSocket): Conn {
    let conn = this.conns.get(ws);
    if (!conn) {
      conn = {
        send: (data) => ws.send(data),
        clients: () => (ws.deserializeAttachment() as Record<number, number>) ?? {},
        setClients: (clients) => ws.serializeAttachment(clients),
      };
      this.conns.set(ws, conn);
    }
    return conn;
  }
}
