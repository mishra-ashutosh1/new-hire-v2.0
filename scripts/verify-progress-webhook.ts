/**
 * Release gate for the `onboarding-progress` webhook.
 *
 * Answers the two questions that matter before re-enabling the tracker fan-out:
 *
 *   1. Does the response contract now derive totals from the sheet
 *      (`total_items` from `total_essentials`, not a hardcoded 4)?
 *   2. Is the destructive read actually fixed — does a read PRESERVE a
 *      non-empty `onboarding_stage`?
 *
 * (2) is the one that cannot be checked by reading alone, because if the column
 * is empty a write of "" over "" is indistinguishable from no write. It gets a
 * non-empty value by asking the WORKFLOW to write it — using the very write
 * path under test, so no extra Sheets permission is needed and the probe works
 * with the deliberately Viewer-only service account (open risk 3).
 *
 * Usage
 *   npx tsx scripts/verify-progress-webhook.ts                     # read-only checks
 *   PROBE_EMP_ID=1302 npx tsx scripts/verify-progress-webhook.ts    # + gate proof
 *
 * Always point PROBE_EMP_ID at a TEST row. Real ids are refused.
 *
 * The read-only checks and the contract assertions are safe to run against
 * production at any time. The gate proof mutates one test row and leaves it at
 * the sentinel value; delete that row as part of cleanup.
 */
export {};

import { readFileSync } from "node:fs";
import { google } from "googleapis";

const env = readFileSync(".env.local", "utf8");
const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const raw = get("GOOGLE_SERVICE_ACCOUNT_JSON");
const credentials = JSON.parse(raw.includes("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));

const BASE = get("N8N_BASE_URL") || "https://ashtosh.app.n8n.cloud";
const ID = process.env.PROBE_EMP_ID ?? "1201";
const ALLOW_WRITE = process.env.PROBE_ALLOW_SHEET_WRITE === "true";

/** Ids we refuse to mutate even with the flag set. */
const REAL_EMPLOYEE_IDS = new Set(["1201"]);

interface Row {
  found: boolean;
  onboarding_stage: string | null;
  total_essentials: string | null;
  completed_essentials: string | null;
  welcome_status: string | null;
}

async function sheets(write = false) {
  return google.sheets({
    version: "v4",
    auth: new google.auth.GoogleAuth({
      credentials,
      // Read paths stay on the narrow scope. The write path needs the full one,
      // otherwise it fails with an insufficient-scope 403 and tells us nothing
      // about whether the gate is fixed.
      scopes: [
        write
          ? "https://www.googleapis.com/auth/spreadsheets"
          : "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    }),
  });
}

async function read(): Promise<Row> {
  const range = (process.env.SHEET_RANGE ?? "Sheet1!A1:J").replace(/^Sheet1!/, "");
  const res = await (await sheets()).spreadsheets.values.get({
    spreadsheetId: get("SHEET_ID"),
    range: `Sheet1!${range}`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const values = res.data.values ?? [];
  const headers = (values[0] ?? []) as string[];
  const at = (n: string) => headers.indexOf(n);
  const row = values
    .slice(1)
    .find((r) => String(r[at("temp_emp_id")] ?? "").trim() === ID);
  return {
    found: !!row,
    onboarding_stage: row ? String(row[at("onboarding_stage")] ?? "") : null,
    total_essentials: row ? String(row[at("total_essentials")] ?? "") : null,
    completed_essentials: row ? String(row[at("completed_essentials")] ?? "") : null,
    welcome_status: row ? String(row[at("welcome_status")] ?? "") : null,
  };
}

/**
 * Populate `onboarding_stage` by asking the WORKFLOW to do it.
 *
 * This needs no Sheets write permission from us — it uses the sanctioned write
 * path the workflow is supposed to implement (a request carrying an explicit
 * `onboarding_stage`). That makes the gate provable even though the service
 * account is deliberately Viewer-only:
 *
 *   1. request WITH onboarding_stage  -> the gate SHOULD fire and write
 *   2. request WITHOUT it (a read)    -> the gate should NOT fire
 *   3. if the value survives step 2, the gate is fixed.
 *
 * If the gate is still broken, step 2 blanks the cell and this reports it
 * plainly; the value is re-seedable by repeating step 1, so the test is
 * self-healing and cannot strand the row empty.
 */
async function writeViaWorkflow(id: string, stage: string) {
  return post({ temp_emp_id: id, onboarding_stage: stage });
}

/**
 * Requires the WRITE scope AND write access on the sheet. The service account
 * is deliberately Viewer-only (open risk 3), so this normally fails with 403 —
 * which is correct posture, not a bug.
 *
 * Prefer writeViaWorkflow() above; this exists only for restoring a value the
 * workflow itself cannot write.
 */
async function writeStage(value: string): Promise<void> {
  const range = (process.env.SHEET_RANGE ?? "Sheet1!A1:J").replace(/^Sheet1!/, "");
  const svc = await sheets(true);
  const res = await svc.spreadsheets.values.get({
    spreadsheetId: get("SHEET_ID"),
    range: `Sheet1!${range}`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const values = res.data.values ?? [];
  const idx = values.slice(1).findIndex((r) => String(r[0] ?? "").trim() === ID);
  if (idx < 0) throw new Error(`${ID} not found`);
  const rowNumber = idx + 2;
  await svc.spreadsheets.values.update({
    spreadsheetId: get("SHEET_ID"),
    range: `Sheet1!I${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

async function post(body: unknown) {
  const res = await fetch(`${BASE}/webhook/onboarding-progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, json: text };
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${detail}`);
}

async function main() {
  console.log(`onboarding-progress @ ${BASE}\ntarget: ${ID}\n`);

  console.log("READ-ONLY CHECKS");
  const before = await read();
  console.log(`  sheet before: ${JSON.stringify(before)}\n`);
  if (!before.found) {
    console.log(`  ABORT: ${ID} is not in the roster.`);
    process.exitCode = 1;
    return;
  }

  const unknown = await post({ temp_emp_id: "zzz-does-not-exist-verify" });
  check(
    "unknown id -> status:not_found at HTTP 200",
    unknown.status === 200 && (unknown.json as { status?: string })?.status === "not_found",
    `HTTP ${unknown.status} status:${(unknown.json as { status?: string })?.status}`,
  );

  const read1 = await post({ temp_emp_id: ID });
  const b = (read1.json ?? {}) as Record<string, unknown>;
  check("real read -> HTTP 200 status:success", read1.status === 200 && b.status === "success", `HTTP ${read1.status} status:${b.status}`);
  check(
    "total_items derives from total_essentials",
    b.total_items === Number(before.total_essentials),
    `total_items=${b.total_items} sheet total_essentials=${before.total_essentials}`,
  );
  check("total_items is NOT the old hardcoded 4", b.total_items !== 4, `total_items=${b.total_items}`);
  check("completed_count derives from completed_essentials", b.completed_count === Number(before.completed_essentials || 0), `completed_count=${b.completed_count} sheet=${before.completed_essentials || "0"}`);
  check("onboarding_status not fabricated", b.onboarding_status === null, `onboarding_status=${JSON.stringify(b.onboarding_status)}`);
  check("read does not request a stage update", b.requested_stage_update === false, `requested_stage_update=${b.requested_stage_update}`);
  check("checklist_source present", typeof b.checklist_source === "string", `checklist_source=${JSON.stringify(b.checklist_source)}`);

  const after = await read();
  console.log(`\n  sheet after read: ${JSON.stringify(after)}`);
  check(
    "read did not change onboarding_stage",
    after.onboarding_stage === before.onboarding_stage,
    `${JSON.stringify(before.onboarding_stage)} -> ${JSON.stringify(after.onboarding_stage)}`,
  );

  console.log("\nGATE PROOF");
  console.log("  A ''->'' write is invisible, so this needs a NON-EMPTY onboarding_stage.");

  if (REAL_EMPLOYEE_IDS.has(ID)) {
    console.log(`  ABORT  refusing to mutate real employee ${ID}. Use a test row (e.g. 1302).`);
    process.exitCode = 1;
    return;
  }

  // Preferred path: seed via the workflow's own write path. Needs no Sheets
  // write access from us, so it works with the Viewer-only service account.
  const sentinel = "Not Started";

  if (ALLOW_WRITE) {
    console.log(`\n  mode: direct sheet write (PROBE_ALLOW_SHEET_WRITE=true)`);
    try {
      await writeStage(sentinel);
    } catch (cause) {
      const status = (cause as { code?: number }).code;
      console.log(
        `  FAIL  could not write the sentinel (${status === 403 ? "HTTP 403 PERMISSION_DENIED" : String(cause)}).`,
      );
      console.log(
        "        Expected: the service account is Viewer-only by design (open risk 3).\n" +
          "        Re-run WITHOUT PROBE_ALLOW_SHEET_WRITE to seed via the workflow instead.",
      );
      failures++;
      console.log(`\n${failures} CHECK(S) FAILED`);
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(`\n  mode: seed via the workflow's own write path (no sheet write needed)`);
    const seed = await writeViaWorkflow(ID, sentinel);
    console.log(`  seed response: HTTP ${seed.status} ${JSON.stringify(seed.json)}`);
  }

  const seeded = await read();
  check(
    `sentinel "${sentinel}" is present on the row`,
    seeded.onboarding_stage === sentinel,
    `onboarding_stage=${JSON.stringify(seeded.onboarding_stage)}`,
  );

  if (seeded.onboarding_stage !== sentinel) {
    console.log(
      "\n  ABORT  the workflow did not persist the stage it was asked to write, so there is\n" +
        "        no value for a read to destroy. The gate stays UNPROVEN; fix the write path\n" +
        "        first, then re-run. Do NOT set TRACKER_PROGRESS_FANOUT=true.",
    );
    console.log(`\n${failures} CHECK(S) FAILED`);
    process.exitCode = 1;
    return;
  }

  console.log("  now issuing a plain read (no onboarding_stage) — it must NOT blank the cell...");
  const read2 = await post({ temp_emp_id: ID });
  const after2 = await read();
  const survived = after2.onboarding_stage === sentinel;
  check(
    "GATE FIXED: plain read preserved a non-empty stage",
    survived,
    `after read: ${JSON.stringify(after2.onboarding_stage)}${survived ? "" : "  <-- STILL DESTROYING DATA"}`,
  );
  const r2 = (read2.json ?? {}) as Record<string, unknown>;
  check("plain read did not request a stage update", r2.requested_stage_update === false, `requested_stage_update=${r2.requested_stage_update}`);
  check("plain read did not fabricate a status", r2.onboarding_status === null, `onboarding_status=${JSON.stringify(r2.onboarding_status)}`);

  if (!ALLOW_WRITE) {
    console.log(
      `\n  NOTE  ${ID} was "${before.onboarding_stage}" before this run and is now "${after2.onboarding_stage}".\n` +
        "        The gate treats an empty stage as \"no update\", so the original empty value cannot be\n" +
        "        restored over the API. That is fine for a test row that gets deleted at cleanup, and is\n" +
        "        the reason real ids are refused above.",
    );
  } else {
    await writeStage(before.onboarding_stage ?? "");
    const restored = await read();
    check("test row restored to its prior value", restored.onboarding_stage === before.onboarding_stage, `${JSON.stringify(restored.onboarding_stage)}`);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  if (failures === 0) {
    console.log("\nThe gate is PROVEN. TRACKER_PROGRESS_FANOUT=true is now safe to set.");
  }
  if (failures > 0) process.exitCode = 1;
}

main();