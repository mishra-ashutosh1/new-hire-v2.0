/**
 * Zero-config demo probe (T067).
 *
 * Starts a dev server with EVERY app variable blanked and `DEMO_MODE=true` as the
 * only setting, which is exactly the state of a fresh deploy where nobody has
 * configured anything — and asserts the portal still renders real content instead
 * of an error or a redirect to /login.
 *
 * The variables are blanked rather than deleted because `.env.local` is read by
 * Next at startup and dotenv does NOT overwrite a key that already exists in
 * `process.env`. Setting them to "" makes them unconfigured for every code path
 * that matters (`if (!sheetId)`, `if (!raw)`) while guaranteeing the local file
 * cannot quietly supply the value this probe claims is absent.
 *
 * Verification, not a test: it drives a live server over HTTP, which the unit
 * suite deliberately does not do.
 *
 *   npm run verify:demo
 */
import { spawn } from "node:child_process";

const PORT = process.argv[2] ?? "3199";
const BASE = `http://localhost:${PORT}`;

/** Every variable the app reads. Blanked so nothing is inherited or loaded. */
const BLANKED = [
  "SHEET_ID",
  "SHEET_RANGE",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "AUDIT_SHEET_ID",
  "N8N_BASE_URL",
  "SESSION_SECRET",
  "HR_ADMIN_PASSCODE_HASH",
  "MANAGER_PASSCODE_HASH",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "HR_ADMIN_EMAILS",
  "MANAGER_EMAILS",
  "ADMIN_CONTRACT_VERIFIED",
  "NEW_HIRE_DRY_RUN",
  "NEW_HIRE_POC_MODE",
  "TRACKER_PROGRESS_FANOUT",
  "TRACKER_FANOUT_CONCURRENCY",
  "TRACKER_ROW_TIMEOUT_MS",
  "APPS_SCRIPT_ID",
  "ONBOARDING_WEBHOOK_URL",
];

interface Check {
  name: string;
  url: string;
  expect: RegExp[];
  /** Patterns that mean the page degraded into an error or a dead end. */
  reject?: RegExp[];
}

const CHECKS: Check[] = [
  {
    name: "dashboard",
    url: "/",
    expect: [/cohort|attention|onboarding|portal/i],
    reject: [/temporarily unavailable/i],
  },
  { name: "tracker", url: "/tracker", expect: [/1401|Ashish|Priya|employee/i] },
  { name: "policies", url: "/policies", expect: [/polic|benefit|leave|search/i] },
  { name: "welcome", url: "/welcome", expect: [/welcome|email|sequence/i] },
  // Must NOT redirect to /login — that is the whole point of demo mode.
  { name: "new-hire", url: "/new-hire", expect: [/provision|employee id/i] },
  { name: "tracker api", url: "/api/tracker", expect: [/"1401"/] },
  { name: "health", url: "/api/health", expect: [/ok|status|healthy|up/i] },
];

async function waitForServer(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.status > 0) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`server did not become ready on ${BASE}`);
}

async function main(): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, DEMO_MODE: "true" };
  for (const key of BLANKED) env[key] = "";

  console.log(`dev server on ${PORT}: DEMO_MODE=true, ${BLANKED.length} variables blanked\n`);
  // `shell: true` is required for `npm` on Windows, and the command is a fixed
  // literal with no interpolated input, so there is nothing to escape.
  // eslint-disable-next-line
  const server = spawn("npm", ["run", "dev", "--", "-p", PORT], {
    env,
    shell: true,
    stdio: "ignore",
  });

  let failures = 0;
  try {
    await waitForServer();

    for (const check of CHECKS) {
      const response = await fetch(`${BASE}${check.url}`, { redirect: "manual" });
      const body = await response.text();
      const location = response.headers.get("location") ?? "";

      const missing = check.expect.filter((pattern) => !pattern.test(body));
      const redirectedToLogin = location.includes("/login");
      const rejected = check.reject?.some((pattern) => pattern.test(body)) ?? false;

      if (response.status >= 400 || missing.length > 0 || redirectedToLogin || rejected) {
        failures += 1;
        console.log(
          `  FAIL ${check.name}: http=${response.status}` +
            (redirectedToLogin ? " REDIRECTED TO LOGIN" : "") +
            (missing.length > 0 ? ` missing ${missing.join(", ")}` : "") +
            (rejected ? " showed an error state" : ""),
        );
      } else {
        console.log(`  ok   ${check.name}: http=${response.status}`);
      }
    }
  } finally {
    server.kill();
  }

  console.log(
    failures === 0
      ? "\nPASS — the portal runs with no configuration at all"
      : `\n${failures} check(s) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();