import { google } from "googleapis";

/**
 * Append-only audit writer (T018).
 *
 * The audit row is written BEFORE employee data is returned. If the audit write
 * fails, the READ FAILS — unlogged PII is never served. This inverts the usual
 * best-effort logging order on purpose: an audit trail that can silently drop
 * entries is not evidence of anything.
 *
 * Stored in a SEPARATE spreadsheet, never in the ingest range. Writing audit
 * rows into the roster range would corrupt the data and create a second source
 * of truth for employee records.
 *
 * `actorEmail` comes from the session and can never be client-supplied (FR-025).
 */

export type AuditAction = "view" | "list" | "advance_stage" | "export" | "create";

export interface AuditEvent {
  actorEmail: string;
  action: AuditAction;
  employeeId: string;
  fieldsDisclosed: string[];
  requestId: string;
}

const HEADER = [
  "timestamp_utc",
  "actor_email",
  "action",
  "emp_id",
  "fields_disclosed",
  "request_id",
];

let client: ReturnType<typeof google.sheets> | null = null;

function getClient(): ReturnType<typeof google.sheets> {
  if (client) return client;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
  const credentials = JSON.parse(
    raw.includes("{") ? raw : Buffer.from(raw, "base64").toString("utf8"),
  ) as { client_email: string; private_key: string };
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  client = google.sheets({ version: "v4", auth });
  return client;
}

/** Best-effort header initialization. Never called on the request path. */
export async function ensureAuditSheet(): Promise<void> {
  const sheetId = process.env.AUDIT_SHEET_ID;
  if (!sheetId) throw new Error("AUDIT_SHEET_ID is not configured");
  try {
    await getClient().spreadsheets.values.get({ spreadsheetId: sheetId, range: "A1:F1" });
  } catch {
    await getClient().spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "A1:F1",
      valueInputOption: "RAW",
      requestBody: { values: [HEADER] },
    });
  }
}

/**
 * Append one audit row. THROWS on failure so the caller fails the read.
 */
export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  const sheetId = process.env.AUDIT_SHEET_ID;
  if (!sheetId) {
    throw new Error("AUDIT_SHEET_ID is not configured — refusing to serve unlogged employee data");
  }

  const row = [
    new Date().toISOString(),
    event.actorEmail,
    event.action,
    event.employeeId,
    event.fieldsDisclosed.join(","),
    event.requestId,
  ];

  await getClient().spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "A:F",
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

/** Audit a list-level disclosure without disclosing per-employee detail. */
export function listAuditEvent(actorEmail: string, requestId: string): AuditEvent {
  return {
    actorEmail,
    action: "list",
    employeeId: "*",
    fieldsDisclosed: ["id", "name", "role", "startDate", "cohort"],
    requestId,
  };
}