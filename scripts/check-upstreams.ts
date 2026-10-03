/**
 * Pre-flight integrity check (T080).
 *
 * Verifies the environment is complete enough to serve employee data, and that
 * the safety gates are in their expected state. Run before starting the app or
 * as a deployment step.
 *
 * This script deliberately FAILS on a missing or weak SESSION_SECRET and warns
 * on the known-open risks rather than pretending they are resolved.
 */

// Makes this file a module. Without it tsx treats it as a global script, and
// two global scripts share one scope — so a helper named `record` in one
// silently collides with an unrelated `record` in another. See the identical
// guard in probe-upstreams.ts.
export {};

import { loadEnvFile } from "./lib/env";

/**
 * Pre-flight integrity check (T080).
 *
 * Verifies the environment is complete enough to serve employee data, and that
 * the safety gates are in their expected state. Run before starting the app or
 * as a deployment step.
 *
 * This script deliberately FAILS on a missing or weak SESSION_SECRET and warns
 * on the known-open risks rather than pretending they are resolved.
 *
 * It also loads `.env.local` itself — see scripts/lib/env.ts for why that is
 * not optional.
 */

loadEnvFile();

// Makes this file a module. Without it tsx treats this as a global script, and
// two global scripts share one scope — so a helper named `record` in one
// silently collides with an unrelated `record` in another. See the identical
// guard in probe-upstreams.ts.
export {};

/**
 * `info` is for a resolved state worth surfacing ("this used to be broken, it
 * is fixed now"), so an operator can tell a deliberate decision from an
 * unexamined default. It is deliberately not `ok`: `ok` means a hard
 * requirement was checked and passed.
 */
interface Result {
  level: "ok" | "info" | "warn" | "fail";
  message: string;
}

const results: Result[] = [];

function assertCheck(condition: boolean, message: string, level: Result["level"] = "fail") {
  results.push({ level: condition ? "ok" : level, message });
}

function runIntegrityChecks() {
  // Hard requirements.
  assertCheck(Boolean(process.env.N8N_BASE_URL), "N8N_BASE_URL is configured");
  assertCheck(Boolean(process.env.SHEET_ID), "SHEET_ID is configured");
  assertCheck(Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), "GOOGLE_SERVICE_ACCOUNT_JSON is configured");
  assertCheck(Boolean(process.env.AUDIT_SHEET_ID), "AUDIT_SHEET_ID is configured (audit writes fail closed)");

  const secret = process.env.SESSION_SECRET ?? "";
  assertCheck(
    secret.length >= 32,
    `SESSION_SECRET is at least 32 characters (currently ${secret.length})`,
  );

  // A secret leaking into NEXT_PUBLIC_ would ship it to the browser bundle.
  const leaked = Object.keys(process.env).filter((key) => key.startsWith("NEXT_PUBLIC_") && key !== "NEXT_PUBLIC_");
  assertCheck(leaked.length === 0, `no secrets use a NEXT_PUBLIC_ prefix${leaked.length ? `: ${leaked.join(", ")}` : ""}`);

  // Range pinning: Sheet2 is a byte-identical mirror.
  const range = process.env.SHEET_RANGE ?? "Sheet1!A1:J";
  assertCheck(
    range.startsWith("Sheet1!"),
    `SHEET_RANGE is pinned to Sheet1 (currently "${range}") — an unpinned read doubles every employee`,
  );

  // Known-open risks, surfaced rather than silently ignored.
  const adminVerified = process.env.ADMIN_CONTRACT_VERIFIED === "true";
  assertCheck(
    true,
    adminVerified
      ? "ADMIN_CONTRACT_VERIFIED=true — provisioning is ENABLED"
      : "ADMIN_CONTRACT_VERIFIED=false — provisioning is disabled by flag",
    "ok",
  );

  if (!adminVerified) {
    results.push({
      level: "warn",
      message:
        "  → POST /api/admin/new-hire returns 503 by design. The contract was CONFIRMED against " +
        "Validate New Hire1 on 2026-10-02 (temp_emp_id, name, role and emailID are required from " +
        "the client); the flag stays off because the form is still a placeholder with no " +
        "tempEmpId field.",
    });
  }

  /*
 * Sign-in configuration. Checked FIRST because it is the one thing that makes the
 * app unusable rather than merely degraded: with no auth method, /login says so and
 * every API returns 401, so the portal serves nobody.
 *
 * EITHER method counts as configured. Google is the better one — it authenticates a
 * person and can scope them to their own employee record — but registering an OAuth
 * client needs Cloud project permissions a Workspace admin holds and an operator
 * does not, so passcode is a legitimate deployment, not a placeholder.
 */
const googleReady = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const adminPasscode = Boolean(process.env.HR_ADMIN_PASSCODE_HASH);
const managerPasscode = Boolean(process.env.MANAGER_PASSCODE_HASH);
const passcodeReady = adminPasscode || managerPasscode;

if (googleReady) {
  const admins = (process.env.HR_ADMIN_EMAILS ?? "").split(/[\s,]+/).filter(Boolean).length;
  const managers = (process.env.MANAGER_EMAILS ?? "").split(/[\s,]+/).filter(Boolean).length;
  if (admins === 0) {
    results.push({
      level: "fail",
      message:
        "  → Google sign-in is configured but HR_ADMIN_EMAILS is EMPTY, so nobody can administer " +
        "the portal. Everyone who signs in is at best a new_hire scoped to their own row.",
    });
  } else {
    results.push({
      level: "ok",
      message:
        `  → Google sign-in configured (${admins} admin, ${managers} manager allowlist entries; ` +
        "addresses are never printed).",
    });
  }
  if (!process.env.GOOGLE_OAUTH_REDIRECT_URI) {
    results.push({
      level: "warn",
      message:
        "  → GOOGLE_OAUTH_REDIRECT_URI is not set, so the redirect URI is derived from the request " +
        "Host header. Proxies rewrite Host, and a redirect_uri mismatch is a silent OAuth failure. " +
        "Set it explicitly in any deployed environment.",
    });
  }
} else if (passcodeReady) {
  results.push({
    level: "ok",
    message:
      `  → Passcode sign-in configured (${[
        adminPasscode ? "hr_admin" : null,
        managerPasscode ? "manager" : null,
      ]
        .filter(Boolean)
        .join(", ")}). Google sign-in is NOT configured — that needs a Cloud project an ` +
      "individual operator cannot create; ask a Workspace admin if you want per-employee " +
      "self-service.",
  });
  results.push({
    level: "info",
    message:
      "  → Passcode sign-in grants a ROLE, not a person. Sessions carry `passcode:<role>` with no " +
      "selfId, so no employee can open their OWN record this way — that needs Google OAuth. The " +
      "rate limiter is in-process (5 attempts / 15 min per address); behind more than one " +
      "instance, or on serverless, move it to a shared store.",
  });
} else {
  results.push({
    level: "fail",
    message:
      "  → NO SIGN-IN METHOD IS CONFIGURED. Run `npm run auth:passcode` and put the printed hash " +
      "in HR_ADMIN_PASSCODE_HASH, or set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Until one of " +
      "those is set, every API returns 401 UNAUTHENTICATED and the portal serves nobody.",
  });
}

if (process.env.TRACKER_PROGRESS_FANOUT === "true") {
    results.push({
      level: "info",
      message:
        "  → TRACKER_PROGRESS_FANOUT=true — the tracker is calling onboarding-progress per " +
        "employee. This is the verified-safe configuration: the workflow's update node is gated " +
        "behind requested_stage_update, and column I was confirmed unchanged across a real " +
        "fan-out on 2026-10-03. Re-verify with `npm run verify:progress` after any workflow edit.",
    });
  } else {
    results.push({
      level: "warn",
      message:
        "  → TRACKER_PROGRESS_FANOUT is off, so per-employee progress is reported as " +
        "unavailable and the tracker shows no stage or percent. This is now a kill switch " +
        "rather than a workaround — the destructive-read hazard it used to work around is fixed. " +
        "Set TRACKER_PROGRESS_FANOUT=true to enable progress.",
    });
  }

  results.push({
    level: "warn",
    message:
      "  → Anonymous access to the source sheet now returns a generic 404, which is what Google " +
      "serves when the requester has no access — suggesting link-sharing was revoked after this " +
      "was flagged (open risk 3). NOT confirmed from here: this check cannot sign in. Verify by " +
      "opening the sheet in a signed-out browser window. If it still loads, sharing is still public " +
      "and it contains live employee PII — restrict it and share with the service account as Viewer.",
  });

  results.push({
    level: "warn",
    message:
      "  → onboarding_stage is empty for every row except the 1302 test row, and the sheet is being " +
      "operated in that state by decision as of 2026-10-03 rather than recovered from version " +
      "history. The destructive read that emptied it is FIXED — nothing will empty it again — but " +
      "the data is gone, so the tracker's Stage column is empty for real employees and the workflow " +
      "reports checklist_source:\"none\". The UI renders that as \"missing data, not zero progress\". " +
      "To recover the original chip values, restore column I from sheet version history.",
  });

  results.push({
    level: "info",
    message:
      "  → The onboarding-progress total_items bug is FIXED: total_items now derives from the " +
      "sheet's total_essentials column instead of a hardcoded 4, verified live " +
      "(npm run verify:progress returns total_items=3 against a sheet value of 3).",
  });

  results.push({
    level: "warn",
    message:
      "  → The onboarding-progress response is internally inconsistent for a chip-valued stage: " +
      "it returned completed_count:1 while completed:[] (checklist_source:\"onboarding_stage\"). " +
      "The checklist is synthesized from the stage label, so nothing is ever in `completed`, but " +
      "the count column is derived from completed_essentials. The UI will show \"1 of 3\" with " +
      "nothing in the completed section. Upstream workflow bug — the BFF passes both through " +
      "unchanged rather than inventing a reconciliation.",
  });

  results.push({
    level: "warn",
    message:
      "  → The policy workflow is NON-DETERMINISTIC for natural-language questions (measured " +
      "2026-10-03: one question answered 4 of 6 consecutive calls, empty the other 2, always at " +
      "status:\"success\"). Short keyword queries were stable. Consequence: the Policy Hub can " +
      "legitimately show \"no policy covers this\" for a question it has answered moments earlier. " +
      "The BFF maps empty and refused answers to status:\"unanswered\" so the UI never fabricates " +
      "an answer — but the feature is unreliable and needs a fix inside the workflow's retrieval.",
  });

  results.push({
    level: "warn",
    message:
      "  → All four questions suggested on /policies are unanswerable against hr_document.md " +
      "(verified 2026-10-03: two return an empty answer, two return the workflow's refusal). A user " +
      "landing on the Policy Hub therefore hits \"no policy covers this\" on every path offered. The " +
      "suggestions need replacing with questions the document actually covers — which requires " +
      "reading hr_document.md, not guessing at it.",
  });

  results.push({
    level: "warn",
    message:
      "  → No delete path exists. A mis-provisioned hire requires a manual sheet edit that " +
      "bypasses the audit trail (open risk 4).",
  });

  const icons: Record<Result["level"], string> = { ok: "OK  ", info: "INFO", warn: "WARN", fail: "FAIL" };
  console.log("Pre-flight checks\n");
  for (const result of results) {
    console.log(`${icons[result.level]}  ${result.message}`);
  }

  const failures = results.filter((r) => r.level === "fail");
  const warnings = results.filter((r) => r.level === "warn");

  console.log(`\n${results.length - failures.length - warnings.length} passed, ${warnings.length} warnings, ${failures.length} failures`);

  if (failures.length > 0) {
    console.error("\nNot ready to serve employee data. Fix the failures above.");
    process.exitCode = 1;
  }
}

runIntegrityChecks();