#!/bin/sh
exec /usr/local/bin/node /usr/local/lib/node_modules/@modelzen/feishu-codex-bridge/bin/feishu-codex-bridge.mjs secrets get "$@"
