# wmaps-relay

Cloudflare Worker that lets map editors find each other. Deployed at
`https://wmaps-relay.innerlattice.workers.dev`.

- `GET /signal/:room` – WebSocket. One SQLite-backed Durable Object per map,
  doing plain topic pub/sub for Trystero's (encrypted) WebRTC handshakes.
  Uses WebSocket Hibernation, and `ping`/`pong` keepalives are auto-answered,
  so idle rooms cost nothing. Map edits go peer to peer, never through here.
- `GET /ice` – ICE servers: Cloudflare STUN plus 4-hour Cloudflare TURN
  credentials (for peers behind strict NATs/firewalls).

Both endpoints only answer browsers from `ALLOWED_ORIGINS` (see `wrangler.jsonc`;
`*` matches one subdomain label, e.g. Netlify deploy previews).

## Deploy

```sh
cd relay
npm install
npx wrangler deploy          # needs CLOUDFLARE_API_TOKEN
```

Secrets (already set on the deployed Worker):

```sh
npx wrangler secret put TURN_KEY_ID          # Realtime TURN key id
npx wrangler secret put TURN_KEY_API_TOKEN   # that key's secret
```

Without them `/ice` falls back to STUN only.

## Costs

Free plan covers a lot: 100k Durable Object requests/day (incoming WebSocket
messages bill at 20:1), and 1,000 GB/month of TURN. Past that, Workers Paid is
$5/month and TURN is $0.05/GB.
