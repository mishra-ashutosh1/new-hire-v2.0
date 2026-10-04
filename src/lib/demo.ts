/**
 * Demo mode (T067).
 *
 * WHAT THIS IS
 * ------------
 * One variable — `DEMO_MODE=true` — makes the whole portal run with NO other
 * configuration: no Google service account, no spreadsheet, no n8n, no OAuth
 * client, no passcode hash, not even a session secret. That exists because the
 * alternative for anyone evaluating this is to stand up five credentials before
 * seeing a single screen, and the first thing they hit is a login page telling
 * them auth is unconfigured.
 *
 * WHAT IT REPLACES, AND WHERE
 * --------------------------
 * Exactly four seams, each chosen so nothing downstream has to know:
 *   session  -> every request is a synthetic `hr_admin`   (auth/session.ts)
 *   roster   -> seeded in-memory rows instead of a read  (sheets/client.ts)
 *   webhooks -> canned responses, no socket is opened   (n8n/client.ts)
 *   audit    -> recorded to memory, never appended       (audit/writer.ts)
 *
 * Everything else is the real code path: the same schemas, the same ingest
 * pipeline, the same classifiers, the same React components. A demo bug is a
 * real bug.
 *
 * THE ONE THING IT WILL NOT DO
 * ----------------------------
 * Pretend to be real. No demo response claims a real email was sent or a real row
 * was written, and nothing can reach the network: `callWebhook` returns before it
 * constructs a URL, so a missing env var cannot turn into an accidental live
 * request. If a demo hire is created it lands in this process's memory and
 * disappears on restart — which is exactly what a demo should do.
 *
 * Off by default. Only the literal string `true` enables it.
 */
export const DEMO_MODE = process.env.DEMO_MODE === "true";

/**
 * The identity every demo request runs as.
 *
 * `hr_admin` because it is the only role that reaches every module, so the demo
 * does not dead-end on a 403 halfway through a walkthrough. `selfId` is set so
 * `canViewEmployee` can still resolve an individual record for the per-employee
 * views.
 */
export const DEMO_SESSION = {
  email: "demo@people-ops.local",
  role: "hr_admin",
  scopedEmployeeIds: null,
  selfId: "1401",
} as const;

/** Human-readable marker so a screenshot cannot be mistaken for production. */
export const DEMO_BADGE = "Demo data — nothing here is real";