#!/usr/bin/env bash
# Two peers in separate processes must sync a Y.Doc through the live relay.
# Usage: scripts/test-relay.sh [relay-url]
set -euo pipefail
export ROOM=$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')
[ -n "${1:-}" ] && export RELAY="$1"
ROLE=a npx vitest run src/sync/relay.live.test.ts & A=$!
ROLE=b npx vitest run src/sync/relay.live.test.ts & B=$!
wait $A && wait $B && echo "relay e2e: OK"
