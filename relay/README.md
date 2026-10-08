# wmaps-relay

Cloudflare Worker for multiplayer maps. Deployed at
`https://wmaps-relay.innerlattice.workers.dev`.

Edits and cursors travel peer to peer: Yjs over WebRTC data channels
(`src/sync/` in the app). The relay does the two things peers can't:

- **Signaling.** `GET /sync/:room` opens a WebSocket into that map's Durable
  Object (`MapRoom`). JSON text frames are signaling: the room gives each
  socket a peer id, tells newcomers who is there (newcomers send the offers),
  and forwards SDP and ICE candidates (`src/signaling.ts`).
- **Saving and loading.** Binary frames on the same socket are the Yjs sync
  protocol against the room's saved copy (`src/store.ts`). Clients load the map
  on connect and upload their own edits; the room saves to SQLite storage 2 s
  after edits and when the last editor leaves. It never forwards edits.
- **ICE.** `GET /ice` returns Cloudflare STUN plus short-lived Cloudflare TURN
  credentials (`src/ice.ts`) for peers behind strict NATs.

Room ids are a hash of the map id, computed in the browser. Keepalive
`ping`/`pong` is answered by the runtime, so idle rooms hibernate. Origins are
checked against `ALLOWED_ORIGINS` (`*` = one DNS label, for Netlify previews).

## Develop and deploy

From the repo root (the relay shares its dependencies):

```sh
yarn relay:dev      # local relay on :8787
yarn relay:deploy   # needs CLOUDFLARE_API_TOKEN
yarn test:live      # WebRTC + saving against the deployed relay
```

Secrets (`wrangler secret put`): `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`, from a
Cloudflare Realtime TURN key. Without them `/ice` returns STUN only.

## Limits and costs

64 editors per map, 64 KB signaling messages, 1 MB sync messages, ~2 MB saved
map. The Workers free plan covers 100k Durable Object requests a day; past
that, Workers Paid is $5/month. TURN is billed per GB relayed, only for peers
that can't connect directly.

### Save receipts and presence

Canvas mouse positions and anonymous user identities are ephemeral Yjs awareness
messages sent over WebRTC, never saved in the map. The menu count includes the
local session; each tab has its own Yjs client ID.

After loading or editing, clients send a JSON `{ "type": "save", "id": N }`
checkpoint after their binary uploads. The relay replies with `saved` and the same
ID only after durable storage commits, or `save-error` on failure. Writes are
serialized. Clients keep newer edits pending, retry failures, and show a red
status on disconnect or a 15-second receipt timeout. Peer edits are also uploaded
(idempotently) so a receipt covers the client's complete visible document.

Deploy the updated relay before releasing the updated client. Older clients
continue using the existing sync protocol. New clients connected to an older
relay will show a save-confirmation error rather than incorrectly report saved.
