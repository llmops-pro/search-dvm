// Env-driven config. Loads .env from the package root only (kit convention).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

const ConfigZ = z.object({
  DVM_NOSTR_PRIVATE_KEY: z.string().min(1, "DVM_NOSTR_PRIVATE_KEY required (run: pnpm gen-identity)"),
  DVM_RELAYS: z.string().transform(csv).pipe(z.array(z.string().url()).min(1)),
  SEARCH_RELAYS: z.string().transform(csv).pipe(z.array(z.string().url()).min(1)),
  RECEIVE_NWC_CONNECTION_STRING: z.string().startsWith("nostr+walletconnect://"),
  PRICE_SATS: z.coerce.number().int().positive().default(50),
  INVOICE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  MAX_RESULTS: z.coerce.number().int().positive().max(100).default(10),
  AUDIT_LOG_PATH: z.string().default("./search-dvm-audit.log"),
});

export type Config = z.infer<typeof ConfigZ>;

function loadDotenv(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  let raw: string;
  try {
    raw = readFileSync(join(root, ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

export function loadConfig(): Config {
  loadDotenv();
  const parsed = ConfigZ.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid search-dvm config:\n${issues}`);
  }
  return parsed.data;
}
