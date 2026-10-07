# wmaps
Created with CodeSandbox

## Multiplayer

Editors in the same map (`/<map-id>`) sync live with Yjs over WebRTC. Peers
find each other through our Cloudflare relay (`relay/`), which also hands out
STUN/TURN servers. Map edits go peer to peer.

| Env var | Default | Purpose |
| --- | --- | --- |
| `VITE_SYNC_RELAY_URL` | `https://wmaps-relay.innerlattice.workers.dev` | Signaling relay + ICE endpoint |
| `VITE_DEBUG_ENABLED` | – | `true` exposes `window.__syncProvider` |

`yarn test:relay` runs two peers in separate processes against the deployed
relay and checks they sync. To develop against a local relay: `cd relay && npx wrangler dev`, then run the
app with `VITE_SYNC_RELAY_URL=http://localhost:8787 yarn dev`.
