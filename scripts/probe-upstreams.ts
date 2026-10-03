/**
 * Upstream contract probe (T079).
 *
 * The contracts in contracts/upstream-integrations.md were observed on
 * 2026-10-02. They DRIFT silently — a workflow edit can change a response shape
 * without failing a build. Two behaviours in particular are load-bearing and
 * easy to break without notice:
 *
 *   1. The three-state trap: onboarding-progress returns success, not_found,
 *      AND error all as HTTP 200.
 *   2. The empty-answer trap: policy returns `status: "success"` with an empty
 *      `answer` string. MEASURED 2026-10-03 as worse than a static shape: the
 *      workflow is NON-DETERMINISTIC for natural-language questions. The same
 *      question over 6 consecutive calls answered 4 times and returned "" twice,
 *      always at `status: "success"`. Short keyword queries were stable. The BFF
 *      maps both the empty answer and the workflow's own refusal to
 *      `status: "unanswered"`, so the UI degrades honestly — but the feature is
 *      unreliable, and `check:upstreams` warns about it on every run.
 *
 * If either flips, this script fails and the BFF contract must be updated
 * BEFORE the UI is touched.
 *
 * NOT READ-ONLY — CORRECTED 2026-10-03, THEN FIXED
 * -------------------------------------------------
 * This file previously claimed "Read-only: it never creates or mutates a
 * record." That was false, and dangerously so.
 *
 * The `onboarding-progress` workflow contained an active googleSheets node,
 * "Update Onboarding Stage", that wrote an **empty string** to the sheet's
 * `onboarding_stage` column on any request omitting `onboarding_stage`. Probes
 * 3, 4 and 5 all POST `{ temp_emp_id }` with no stage, so running this script
 * BLANKED column I for the probed employee — and probe 4 targets `PROBE_EMP_ID`,
 * a real employee, by default. Column H is a formula over column I, so it blanked
 * too. The same defect made `GET /api/tracker` wipe the column once per employee
 * every 30s, which is why the app shipped with its fan-out off.
 *
 * That node is now gated behind `requested_stage_update`, so a read that omits
 * the stage writes nothing, and the gate is proven rather than assumed —
 * `npm run verify:progress` seeds a value through the workflow's own write path
 * and confirms a plain read leaves it intact, then confirms column I is
 * unchanged across a real `GET /api/tracker` fan-out.
 *
 * So the gating is lifted: keeping probes 3-5 behind `PROBE_ALLOW_SHEET_WRITES`
 * would leave the onboarding-progress contract permanently UNVERIFIED by tooling
 * for a hazard that no longer exists. The welcome probe below is still
 * conditional, because ITS danger is real and independent — see step 6.
 */

// Makes this file a module — see the identical guard in check-upstreams.ts.
export {};

import { google } from "googleapis";
import { loadEnvFile } from "./lib/env";

loadEnvFile();

/*
 * `PROBE_ALLOW_SHEET_WRITES` is accepted but ignored. It used to gate probes
 * 3-5, and it is deliberately still READ rather than rejected: a stale value in
 * someone's .env.local or CI config should not turn into a confusing "unknown
 * flag" failure on a script that is now safe to run unconditionally. Silently
 * ignoring it would be worse, so warn when it is set to something unexpected.
 */
const LEGACY_WRITE_FLAG = process.env.PROBE_ALLOW_SHEET_WRITES;

const BASE = process.env.N8N_BASE_URL ?? "https://ashtosh.app.n8n.cloud";
const KNOWN_ID = process.env.PROBE_EMP_ID ?? "1201";

interface Check {
  name: string;
  expected: string;
  pass: boolean;
  detail: string;
  /** Skipped checks neither pass nor fail — they are gated, not satisfied. */
  skipped?: boolean;
}

const checks: Check[] = [];

async function postWebhook(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${BASE}/webhook/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

function record(name: string, expected: string, pass: boolean, detail: string) {
  checks.push({ name, expected, pass, detail });
}

/** Record a gated check: neither a pass nor a failure. */
function recordSkipped(name: string, expected: string, reason: string) {
  checks.push({ name, expected, pass: true, detail: reason, skipped: true });
}

/**
 * Read `welcome_status` for the probe employee straight from the sheet.
 *
 * The welcome workflow gates on `welcome_status === "welcome_sent"` (exact,
 * case-sensitive — verified in its `Welcome Already Sent?` node). Only on a
 * match does it short-circuit to `already_sent` with no email and no write; on
 * ANY other value it generates a message, sends a real email, and then runs
 * `Update Status`, which writes the sheet.
 *
 * So the probe is inert only while the employee is ALREADY marked sent. Reading
 * the column first makes the guarantee explicit instead of accidental: the
 * welcome probe runs only when it provably cannot send, and is skipped otherwise.
 * That keeps the `already_sent` idempotency contract verified — which gating it
 * away entirely would not.
 */
async function readWelcomeStatus(tempEmpId: string): Promise<string | null> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.SHEET_ID;
  if (!raw || !sheetId) return null;

  try {
    const credentials = JSON.parse(
      raw.includes("{") ? raw : Buffer.from(raw, "base64").toString("utf8"),
    );
    const sheets = google.sheets({
      version: "v4",
      auth: new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      }),
    });
    const range = `${process.env.SHEET_RANGE ?? "Sheet1!A1:J"}`.replace(/^Sheet1!/, "");
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `Sheet1!${range}`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const values = res.data.values ?? [];
    const headers = (values[0] ?? []) as string[];
    const idIdx = headers.indexOf("temp_emp_id");
    const statusIdx = headers.indexOf("welcome_status");
    if (idIdx < 0 || statusIdx < 0) return null;
    for (const row of values.slice(1)) {
      if (String(row[idIdx] ?? "").trim() === tempEmpId) {
        return String(row[statusIdx] ?? "").trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

function statusOf(json: unknown): string {
  const value = (json as { status?: unknown } | null)?.status;
  return typeof value === "string" ? value : "(none)";
}

async function runProbes() {
  console.log(`Probing ${BASE}\n`);
  if (LEGACY_WRITE_FLAG !== undefined) {
    console.warn(
      `\n  note  PROBE_ALLOW_SHEET_WRITES=${LEGACY_WRITE_FLAG} is set but no longer has any effect.\n` +
        "        The onboarding-progress probes are no longer gated: the workflow's update node is\n" +
        "        gated behind requested_stage_update, so a read no longer writes to the sheet.\n",
    );
  }

  // 1. GET must 404 — these are POST-only. Not an outage.
  const getResponse = await fetch(`${BASE}/webhook/onboarding-progress`, { method: "GET" }).catch(() => null);
  record(
    "GET returns 404 (POST-only webhook)",
    "404",
    getResponse?.status === 404,
    `got ${getResponse?.status ?? "no response"}`,
  );

  // 2. admin rejects an empty body.
  const admin = await postWebhook("admin", {});
  record("admin rejects empty body", "400", admin.status === 400, `got ${admin.status}`);

  /*
   * Probes 3-5 are the onboarding-progress contract checks. Each POSTs a bare
   * `{ temp_emp_id }`.
   *
   * These were gated until 2026-10-03 because that request used to make the
   * workflow write an empty string to the sheet's `onboarding_stage` column. The
   * workflow's update node is now gated behind `requested_stage_update`, and the
   * gate is proven rather than assumed: `npm run verify:progress` seeds a value
   * through the workflow's own write path and confirms a plain read leaves it
   * intact. So these probes are safe to run against production again, and
   * leaving them gated would keep the onboarding-progress contract permanently
   * UNVERIFIED by tooling for no reason.
   *
   * They still target PROBE_EMP_ID, so point that at a test row if you want the
   * probe to be doubly conservative — but it no longer mutates anything.
   */

  // 3. progress without an id → the body-level error state.
    const missing = await postWebhook("onboarding-progress", {});
    record(
      "progress missing id → status:error at HTTP 200",
      "200 + status:error",
      missing.status === 200 && statusOf(missing.json) === "error",
      `got HTTP ${missing.status} status:${statusOf(missing.json)}`,
  );

  // 4. progress for a known id → success.
  const success = await postWebhook("onboarding-progress", { temp_emp_id: KNOWN_ID });
  record(
    `progress for ${KNOWN_ID} → status:success`,
    "status:success",
    statusOf(success.json) === "success",
    `status:${statusOf(success.json)}`,
  );

  // 5. progress for an unknown id → not_found AT HTTP 200. This is the trap.
  const notFound = await postWebhook("onboarding-progress", {
    temp_emp_id: "does-not-exist-zzz",
  });
  record(
    "progress unknown id → status:not_found at HTTP 200",
    "200 + status:not_found",
    notFound.status === 200 && statusOf(notFound.json) === "not_found",
    `got HTTP ${notFound.status} status:${statusOf(notFound.json)}`,
  );

  /*
   * 6. welcome — SAFE ONLY IF the employee is already marked sent.
   *
   * The workflow short-circuits to `already_sent` with no email and no write
   * when `welcome_status` is exactly "welcome_sent". Otherwise it sends a real
   * email and writes the column. So we read the column first and only call the
   * webhook when the call provably cannot send.
   */
  const welcomeStatus = await readWelcomeStatus(KNOWN_ID);
  if (welcomeStatus === "welcome_sent") {
    const welcome = await postWebhook("welcome", { temp_emp_id: KNOWN_ID });
    record(
      "welcome → already_sent (idempotent success)",
      "already_sent",
      statusOf(welcome.json) === "already_sent",
      `status:${statusOf(welcome.json)}`,
    );
  } else {
    recordSkipped(
      "welcome → already_sent (idempotent success)",
      "already_sent",
      welcomeStatus === null
        ? `skipped: could not read welcome_status for ${KNOWN_ID} — calling it could SEND A REAL EMAIL`
        : `skipped: ${KNOWN_ID} welcome_status is "${welcomeStatus}", not "welcome_sent" — calling it would send a real email and write the sheet`,
    );
  }

  // 7. policy accepts ONLY `question`. Every other parameter 400s.
  const policy = await postWebhook("policy", { question: "remote work" });
  const policyStatus = statusOf(policy.json);
  record(
    "policy accepts {question}",
    "status:success",
    policyStatus === "success",
    `status:${policyStatus}`,
  );

  const policyBody = (policy.json ?? {}) as { answer?: unknown; source?: unknown };
  record(
    "policy carries a source filename",
    "source present",
    typeof policyBody.source === "string",
    `source=${String(policyBody.source)}`,
  );

  /*
   * The empty-answer trap, actually asserted.
   *
   * The header above calls this trap load-bearing, but until now nothing checked
   * `answer` — both policy probes asserted only `status` and `source`, and both
   * hold even when the answer is empty. A workflow that stopped answering
   * entirely would have passed this suite unchanged.
   *
   * Retried rather than asserted once, because MEASURED 2026-10-03: the workflow
   * is NON-DETERMINISTIC for natural-language questions. "What is the sick leave
   * policy?" over 6 consecutive calls returned a real 745-904 character answer 4
   * times and an empty string twice, every time at `status: "success"`. A single
   * assertion would flake roughly one run in three.
   *
   * A short keyword query ("remote work") was stable at 105 characters across 6
   * runs, so that is used here. The retry still matters: stability is a property
   * of the upstream model, not a guarantee, and a release gate that flakes gets
   * ignored. What this asserts is the property that actually matters — the
   * workflow CAN answer — not that it answers every single time.
   */
  let answered = false;
  let attempts = 0;
  let lastLen = 0;
  for (let attempt = 1; attempt <= 3 && !answered; attempt++) {
    const retry = await postWebhook("policy", { question: "remote work" });
    const len = String((retry.json as { answer?: unknown })?.answer ?? "").trim().length;
    attempts = attempt;
    lastLen = len;
    if (len > 0) answered = true;
  }
  record(
    "policy returns a NON-EMPTY answer (the empty-answer trap)",
    "answer length > 0",
    answered,
    answered
      ? `answered on attempt ${attempts} (${lastLen} chars)`
      : `EMPTY on all ${attempts} attempts — workflow is answering nothing`,
  );

  // Report.
  console.log("Check".padEnd(50), "Expected".padEnd(24), "Result");
  console.log("-".repeat(100));
  let failures = 0;
  let skipped = 0;
  for (const check of checks) {
    if (check.skipped) skipped++;
    if (!check.pass) failures++;
    const tag = check.skipped ? "SKIP" : check.pass ? "PASS" : "FAIL";
    console.log(
      `${tag}  ${check.name.padEnd(46)} ${check.expected.padEnd(22)} ${check.detail}`,
    );
  }

  const skippedNames = checks.filter((c) => c.skipped).map((c) => c.name);
  console.log(
    `\n${checks.length - failures - skipped}/${checks.length} checks passed` +
      (skipped > 0 ? `, ${skipped} skipped` : ""),
  );

  if (skipped > 0) {
    // Be specific about WHICH contract is unverified. The blanket "the
    // onboarding-progress contract is UNVERIFIED" warning this replaced was
    // wrong the moment probes 3-5 stopped being skipped — it would have claimed
    // an unverified contract that had in fact just been verified.
    console.warn(
      `\nSkipped: ${skippedNames.join("; ")}.\n` +
        "The onboarding-progress contract IS verified by this run. Anything skipped here is a\n" +
        "probe that could not be performed safely — the welcome probe, for instance, is skipped\n" +
        "unless welcome_status is exactly 'welcome_sent', because any other value sends a real email.",
    );
  }

  if (failures > 0) {
    console.error(
      "\nUpstream contracts have drifted from contracts/upstream-integrations.md.\n" +
        "Update the BFF contract before changing the UI.",
    );
    process.exitCode = 1;
  }
}

runProbes().catch((cause: unknown) => {
  console.error("Probe failed to run:", cause);
  process.exitCode = 1;
});