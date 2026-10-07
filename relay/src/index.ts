import { DurableObject } from "cloudflare:workers";

/**
 * wmaps signaling relay.
 *
 *   GET /signal/:room  WebSocket. One Durable Object per map room; plain
 *                      topic pub/sub used by Trystero to exchange (encrypted)
 *                      WebRTC offers/answers. Document data never comes here.
 *   GET /ice           ICE servers for RTCPeerConnection: Cloudflare STUN, plus
 *                      short-lived Cloudflare TURN credentials when the
 *                      TURN_KEY_ID / TURN_KEY_API_TOKEN secrets are set.
 */

export interface Env {
  SIGNAL_ROOM: DurableObjectNamespace<SignalRoom>;
  ALLOWED_ORIGINS: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

const ROOM_ID = /^[a-f0-9]{16,64}$/;
const STUN: RTCIceServerLike = { urls: ["stun:stun.cloudflare.com:3478"] };
const TURN_TTL_SECONDS = 4 * 60 * 60;

type RTCIceServerLike = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    const allowed = isAllowedOrigin(origin, env);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin, allowed) });
    }

    if (url.pathname === "/ice" && req.method === "GET") {
      if (!allowed) return new Response("Forbidden", { status: 403 });
      return Response.json(
        { iceServers: await iceServers(env) },
        {
          headers: {
            ...cors(origin, allowed),
            // Credentials are per-visitor; never cache in shared caches.
            "Cache-Control": "private, max-age=600",
          },
        }
      );
    }

    const match = url.pathname.match(/^\/signal\/([^/]+)$/);
    if (match) {
      if (!allowed) return new Response("Forbidden", { status: 403 });
      if (!ROOM_ID.test(match[1])) {
        return new Response("Bad room id", { status: 400 });
      }
      if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const stub = env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(match[1]));
      return stub.fetch(req);
    }

    if (url.pathname === "/") return new Response("wmaps relay ok\n");
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/** Wildcards like https://*--wmaps.netlify.app cover deploy previews. */
function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  return env.ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((pattern) => {
      if (!pattern.includes("*")) return pattern === origin;
      const re = new RegExp(
        "^" +
          pattern
            .split("*")
            .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
            .join("[a-z0-9-]+") +
          "$"
      );
      return re.test(origin);
    });
}

function cors(origin: string | null, allowed: boolean): Record<string, string> {
  return allowed && origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
}

async function iceServers(env: Env): Promise<RTCIceServerLike[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return [STUN];
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      }
    );
    if (!res.ok) throw new Error(`TURN API ${res.status}`);
    const body = (await res.json()) as { iceServers: RTCIceServerLike[] };
    // Port 53 is blocked by browsers and just makes ICE wait for a timeout.
    return body.iceServers.map((s) => ({
      ...s,
      urls: [s.urls].flat().filter((u) => !/:53(\?|$)/.test(u)),
    }));
  } catch (err) {
    console.error("TURN credential request failed", err);
    return [STUN];
  }
}

// ---------------------------------------------------------------------------

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_TOPICS_PER_SOCKET = 16;
const MAX_SOCKETS_PER_ROOM = 64;

type Attachment = { topics: string[] };
type ClientMessage =
  | { type: "subscribe" | "unsubscribe"; topic: string }
  | { type: "publish"; topic: string; payload: unknown };

/**
 * One instance per map. Uses the WebSocket Hibernation API so idle rooms cost
 * no duration; keepalive pings are answered by the runtime without waking us.
 */
export class SignalRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  async fetch(_req: Request): Promise<Response> {
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS_PER_ROOM) {
      return new Response("Room full", { status: 429 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ topics: [] } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.topic !== "string" || msg.topic.length > 256) return;

    const state = (ws.deserializeAttachment() as Attachment) ?? { topics: [] };

    switch (msg.type) {
      case "subscribe":
        if (
          !state.topics.includes(msg.topic) &&
          state.topics.length < MAX_TOPICS_PER_SOCKET
        ) {
          state.topics.push(msg.topic);
          ws.serializeAttachment(state);
        }
        return;
      case "unsubscribe":
        state.topics = state.topics.filter((t) => t !== msg.topic);
        ws.serializeAttachment(state);
        return;
      case "publish": {
        const out = JSON.stringify({ topic: msg.topic, payload: msg.payload });
        for (const peer of this.ctx.getWebSockets()) {
          if (peer === ws) continue;
          const peerState = peer.deserializeAttachment() as Attachment | null;
          if (!peerState?.topics.includes(msg.topic)) continue;
          try {
            peer.send(out);
          } catch {
            // Socket is closing; the runtime will call webSocketClose.
          }
        }
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close(1011, "error");
    } catch {
      // already closed
    }
  }
}
