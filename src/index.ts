#!/usr/bin/env node
// Entry point. Installs the `ws` WebSocket before ANY nostr-tools code is
// evaluated (see ws-polyfill.ts), then loads the program. The dynamic import
// is deliberate: in a bundle, static imports of dependencies are hoisted and
// evaluated first, which would let nostr-tools capture Node's built-in
// WebSocket before the polyfill runs.
import "./ws-polyfill.js";

await import("./main.js");
