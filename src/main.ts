// search-dvm — a NOSTR Data Vending Machine (NIP-90 kind 5302, Nostr Content
// Search). Listens for paid search jobs, verifies settlement on our own node,
// returns matching notes. Signs with a dedicated DVM identity (never the brand key).
import { getPublicKey, nip19, SimplePool } from "nostr-tools";
import WebSocket from "ws";
import { AuditLog } from "./audit.js";
import { loadConfig } from "./config.js";
import { announce, handleJob, JOB_REQUEST } from "./dvm.js";
import { PaymentGate } from "./payment.js";
import { superviseSubscriptions } from "./supervisor.js";

const VERSION = "0.2.1";
const REANNOUNCE_MS = 6 * 60 * 60 * 1000;

function secretKeyBytes(raw: string): Uint8Array {
  if (raw.startsWith("nsec1")) return nip19.decode(raw).data as Uint8Array;
  return Uint8Array.from(Buffer.from(raw, "hex"));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sk = secretKeyBytes(config.DVM_NOSTR_PRIVATE_KEY);
  const pubkey = getPublicKey(sk);
  // enablePing detects silently dead sockets; reconnecting is done by the
  // supervisor (see supervisor.ts), not by the library.
  const pool = new SimplePool({ enablePing: true, websocketImplementation: WebSocket } as ConstructorParameters<typeof SimplePool>[0]);
  const gate = new PaymentGate(config.RECEIVE_NWC_CONNECTION_STRING);
  const audit = new AuditLog(config.AUDIT_LOG_PATH);
  const deps = { config, pool, sk, pubkey, gate, audit };

  audit.record("startup", { version: VERSION, npub: nip19.npubEncode(pubkey), kind: JOB_REQUEST, price_sats: config.PRICE_SATS });
  console.error(
    `search-dvm v${VERSION} | npub ${nip19.npubEncode(pubkey)} | kind ${JOB_REQUEST} | ${config.PRICE_SATS} sats | ` +
    `listen ${config.DVM_RELAYS.length} relays | search ${config.SEARCH_RELAYS.length} relays`,
  );

  await announce(deps);

  // One supervised subscription per relay; resubscribes on any drop, so the
  // process never runs out of work and exits (see supervisor.ts).
  const subs = superviseSubscriptions({
    pool,
    relays: config.DVM_RELAYS,
    filter: { kinds: [JOB_REQUEST] },
    onevent: (ev) => {
      handleJob(deps, ev).catch((err) =>
        audit.record("error", { job_id: ev.id, stage: "handle", error: String(err).slice(0, 160) }),
      );
    },
    log: (event, data) => audit.record(event, data),
  });

  // Keep the NIP-89 announcement fresh on every relay, including ones that
  // were down at startup.
  const reannounce = setInterval(() => {
    announce(deps).catch((err) => audit.record("error", { stage: "announce", error: String(err).slice(0, 160) }));
  }, REANNOUNCE_MS);

  const shutdown = () => {
    try {
      subs.stop();
      clearInterval(reannounce);
      pool.close(config.DVM_RELAYS);
      gate.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("search-dvm fatal:", err);
  process.exit(1);
});
