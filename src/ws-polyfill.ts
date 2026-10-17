// Must be imported before anything that loads nostr-tools (including
// @getalby/sdk, which bundles its own copy). Replaces Node's built-in
// WebSocket with the `ws` library: on Node 22, a failed connection makes
// nostr-tools' error handler call close(), which fires the error handler
// again until the stack overflows and the process crashes (seen live on Fly
// 2026-10-17). Setting the global covers every nostr-tools copy, whatever
// version npm/pnpm resolves.
import WebSocket from "ws";

(globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
