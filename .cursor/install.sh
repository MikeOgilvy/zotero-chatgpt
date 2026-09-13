#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Zotero Codex Reader.
# Prepares the pinned Node 24 toolchain, installs dependencies from the committed
# lockfile, and fetches the SHA-256-verified bundled Codex runtime so the packaging
# and verification commands documented in docs/development.md work out of the box.
set -euo pipefail

cd "$(dirname "$0")/.."

# The repo pins Node via .nvmrc (24.11.0) and requires engines ">=24 <25". The base
# image defaults to Node 22, so select the pinned version through nvm and make it the
# default for every future shell/terminal in this environment.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

NODE_VERSION="$(tr -d '[:space:]' < .nvmrc)"
nvm install "$NODE_VERSION"
nvm alias default "$NODE_VERSION"
nvm use "$NODE_VERSION"

echo "Using Node $(node --version) / npm $(npm --version)"

# Deterministic dependency install from package-lock.json.
npm ci

# Fetch + verify the pinned Codex 0.144.1 archive into the ignored .zcr-dev/runtime-cache/.
# This is idempotent: it skips the download when the archive is already present and its
# SHA-256 matches runtime/manifest.ts. Required by `npm run package:dev`.
node scripts/runtime-prepare.mjs

echo "Zotero Codex Reader environment ready."
