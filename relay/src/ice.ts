/**
 * ICE servers for browsers: Cloudflare STUN, plus short-lived Cloudflare TURN
 * credentials when the TURN_KEY_ID / TURN_KEY_API_TOKEN secrets are set.
 */

export interface IceEnv {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const STUN: IceServer = { urls: ["stun:stun.cloudflare.com:3478"] };
const TURN_TTL_SECONDS = 4 * 60 * 60;

export async function iceServers(env: IceEnv, fetcher: typeof fetch = fetch): Promise<IceServer[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return [STUN];
  try {
    const res = await fetcher(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      }
    );
    if (!res.ok) throw new Error(`TURN API ${res.status}`);
    const body = (await res.json()) as { iceServers: IceServer[] };
    return body.iceServers.map(withoutPort53);
  } catch (err) {
    console.error("TURN credential request failed", err);
    return [STUN];
  }
}

/** Browsers block port 53, so those URLs only make ICE wait for a timeout. */
function withoutPort53(server: IceServer): IceServer {
  return { ...server, urls: [server.urls].flat().filter((url) => !/:53(\?|$)/.test(url)) };
}
