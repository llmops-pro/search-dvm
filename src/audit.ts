// NDJSON audit log — kit convention. Append-only, never throws.
import { appendFileSync } from "node:fs";

export type AuditEvent =
  | "startup"
  | "announce"
  | "job_received"
  | "no_input"
  | "payment_required"
  | "settled"
  | "result_published"
  | "payment_timeout"
  | "error";

export class AuditLog {
  constructor(private readonly path: string) {}
  record(event: AuditEvent, fields: Record<string, unknown> = {}): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields });
    try {
      appendFileSync(this.path, line + "\n");
    } catch (err) {
      console.error(`search-dvm: audit write failed (${String(err)}): ${line}`);
    }
  }
}
