import { google } from "googleapis";

import { DEMO_MODE } from "@/lib/demo";
import { demoRosterRows } from "@/lib/demo/roster";

/**
 * Google Sheets client (T014).
 *
 * The range is PINNED. This is load-bearing, not a style choice: Sheet2 is a
 * byte-identical mirror of Sheet1, so an unpinned workbook read silently
 * doubles every employee. Pinning `Sheet1!A1:J` makes the mirror unreachable.
 *
 * `valueRenderOption: FORMATTED_VALUE` is equally deliberate. UNFORMATTED
 * returns serials for any cell an HR user later reformats as a true date,
 * silently changing the type underneath the app.
 */

export const DEFAULT_RANGE = process.env.SHEET_RANGE ?? "Sheet1!A1:J";

export interface RawSheetRow {
  rowNumber: number;
  cells: Record<string, string>;
}

/** Header order matches the verified sheet columns. */
export const COLUMNS = [
  "temp_emp_id",
  "name",
  "role",
  "start_date",
  "cohort",
  "emailID",
  "total_essentials",
  "completed_essentials",
  "onboarding_stage",
  // Verified header is `welcome_status`, NOT `onboarding_status`. There is no
  // `onboarding_status` column in Sheet1 — it is a name the n8n progress
  // workflow invented, and it is why that workflow reports 0/4 completion.
  "welcome_status",
] as const;

let sheetsClient: ReturnType<typeof google.sheets> | null = null;

function getClient(): ReturnType<typeof google.sheets> {
  if (sheetsClient) return sheetsClient;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");

  const credentials = JSON.parse(
    raw.includes("{") ? raw : Buffer.from(raw, "base64").toString("utf8"),
  ) as { client_email: string; private_key: string };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

export interface SheetReadResult {
  rows: RawSheetRow[];
  /** Raw header row, used to map cells when the sheet's column order drifts. */
  headers: string[];
  etag: string | null;
}

/**
 * Read the roster. Throws on failure — callers serve a cached snapshot via the
 * stale-while-revalidate path in cache.ts rather than failing the request.
 */
export async function readRoster(range: string = DEFAULT_RANGE): Promise<SheetReadResult> {
  // Demo mode answers here, before any credential lookup, so an unconfigured
  // environment still produces a roster instead of throwing. Everything
  // downstream — cache, ingest, tracker — is the real code path.
  if (DEMO_MODE) {
    return { rows: demoRosterRows(), headers: [...COLUMNS], etag: null };
  }

  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID is not configured");

  const response = await getClient().spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const values = response.data.values ?? [];
  const headerRow = (values[0] ?? []) as string[];
  const headers = headerRow.length > 0 ? headerRow : [...COLUMNS];

  // Map by header NAME rather than fixed position, so an HR column insertion
  // shifts data rather than scrambling it against the wrong field.
  const rows: RawSheetRow[] = values.slice(1).map((row, index) => {
    const cells: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      const value = row[columnIndex];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        cells[header.trim()] = String(value).trim();
      }
    });
    return { rowNumber: index + 2, cells }; // +2: 1-indexed, and row 1 is the header
  });

  const etag = (response.headers as Record<string, string> | undefined)?.etag ?? null;

  return { rows, headers, etag };
}

export async function probeSheetReachable(): Promise<boolean> {
  try {
    await readRoster();
    return true;
  } catch {
    return false;
  }
}