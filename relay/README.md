# wmaps-relay

Cloudflare Worker that syncs maps. Deployed at
`https://wmaps-relay.innerlattice.workers.dev`.

`GET /sync/:room` opens a WebSocket into that map's Durable Object
(`MapRoom`). It holds the Yjs document, relays edits and cursors between
editors, and saves the document to its SQLite storage (2 s after an edit, and
when the last editor leaves), so a map is there for whoever opens it next.

- `src/room.ts` – the document logic (`YRoom`), runtime-free and unit tested.
- `src/index.ts` – Worker routing and the Durable Object glue.
- `src/origins.ts` – `ALLOWED_ORIGINS` matching (`*` = one DNS label, for
  Netlify deploy previews).

Room ids are a hash of the map id, computed in the browser. Keepalive
`ping`/`pong` is answered by the runtime, so idle rooms can hibernate.

## Develop and deploy

From the repo root (the relay shares its dependencies):

```sh
yarn relay:dev      # local relay on :8787
yarn relay:deploy   # needs CLOUDFLARE_API_TOKEN
```

## Limits and costs

64 editors per map, 1 MB per message, ~2 MB saved document. The Workers free
plan covers 100k Durable Object requests a day (incoming WebSocket messages
bill at 20:1); past that, Workers Paid is $5/month.
