# wmaps
Created with CodeSandbox

## Multiplayer

Editors on the same map (`/<map-id>`) sync live with Yjs over WebRTC, peer
to peer. Our Cloudflare relay (`relay/`) does signaling, hands out TURN
credentials, and saves and loads each map in a Durable Object.

| Env var | Default | Purpose |
| --- | --- | --- |
| `VITE_SYNC_RELAY_URL` | `https://wmaps-relay.innerlattice.workers.dev` | Signaling and storage relay |

To develop against a local relay: `yarn relay:dev`, then run the app with
`VITE_SYNC_RELAY_URL=http://localhost:8787 yarn dev`.

## Code quality gate

`yarn quality` checks the code you changed (against `origin/HEAD`, plus
uncommitted and new files): every edited function needs CRAP ≤ 8 and a
maintainability index above 75, and every edited file an MI above 75
(171-point scale, as escomplex/Plato). Coverage comes from the Vitest suite.

It runs automatically before `git push` (`.githooks/pre-push`, enabled by
`yarn install`). Use `--verbose` to see every function, `--help` for options.
