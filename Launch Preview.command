#!/bin/zsh
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ ! -d node_modules ]; then
  npm ci
fi
node host/start-preview.mjs
