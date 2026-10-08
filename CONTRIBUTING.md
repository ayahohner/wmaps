# Contributing to MapTogether

Thanks for helping out. This guide covers running the app locally, how it fits
together, and the checks your change needs to pass.

## Setup

You need Node 24 or later (see `.nvmrc`) and Yarn 4 (run `corepack enable` to
get it).

```sh
yarn install   # also enables the pre-push hook in .githooks/
yarn dev       # app on http://localhost:5173, using the deployed relay
```

| Script | What it does |
| --- | --- |
| `yarn dev` | Vite dev server |
| `yarn build` / `yarn serve` | Production build and a local preview of it |
| `yarn test` | Vitest in watch mode |
| `yarn coverage` | One Vitest run with coverage |
| `yarn quality` | Code quality gate (see below) |
| `yarn relay:dev` | Local relay on `:8787` |
| `yarn relay:deploy` | Deploy the relay (needs `CLOUDFLARE_API_TOKEN`) |
| `yarn test:live` | WebRTC and saving against the deployed relay |

## How it fits together

The map is a plain-text document. The canvas and the code editor are two views
of that one text:

1. The text lives in a Yjs `Y.Text`, bound to CodeMirror (`src/editor/`).
2. On every change it is parsed with a Chevrotain grammar
   (`src/parser/TogetherParser.ts`) into a graphology graph (`src/state/Graph.ts`).
3. The graph is drawn with PixiJS (`src/map/`).
4. Canvas interactions (adding, moving, renaming, linking, deleting) edit the
   text, which flows back through the same path.

UI state uses valtio (`src/state/State.ts`); the menu is React with Headless UI
and Tailwind (`src/menu/`).

## Multiplayer

Editors on the same map (`/<map-id>`) sync live with Yjs over WebRTC, peer
to peer (`src/sync/`). Our Cloudflare relay (`relay/`) does signaling, hands out
TURN credentials, and saves and loads each map in a Durable Object. Canvas
cursors and user names are ephemeral Yjs awareness state and are never saved.
See [relay/README.md](relay/README.md) for the protocol, limits, and deployment.

| Env var | Default | Purpose |
| --- | --- | --- |
| `VITE_SYNC_RELAY_URL` | `https://wmaps-relay.innerlattice.workers.dev` | Signaling and storage relay |

To develop against a local relay: `yarn relay:dev`, then run the app with
`VITE_SYNC_RELAY_URL=http://localhost:8787 yarn dev`. To try multiplayer
locally, open the same map URL in two browser windows.

Deploy relay changes before releasing a client that depends on them. The
[Deploy Cloudflare relay](.github/workflows/deploy-relay.yml) workflow validates
pull requests and deploys `main` automatically when relay or sync code changes.

## Code quality gate

`yarn quality` checks the code you changed (against `origin/HEAD`, plus
uncommitted and new files): every edited function needs CRAP ≤ 8 and a
maintainability index above 75, and every edited file an MI above 75
(171-point scale, as escomplex/Plato). Coverage comes from the Vitest suite.

It runs automatically before `git push` (`.githooks/pre-push`, enabled by
`yarn install`). Use `--verbose` to see every function, `--help` for options.

## README screenshot

`docs/multiplayer-screenshot.png` shows [`examples/tea-shop.twm`](examples/tea-shop.twm)
open in four headless Chromium sessions against a local relay: one takes the
screenshot while three others hover the canvas. If the UI changes noticeably,
retake it the same way at a 1440×860 viewport.
