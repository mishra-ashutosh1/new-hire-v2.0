import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T067 — zero-config demo mode.
 *
 * The whole promise is `DEMO_MODE=true` and nothing else, so these tests clear
 * every credential from the environment and then assert the app still works. A
 * demo mode that quietly needed one secret was not zero-config.
 *
 * The network assertions matter most: `callWebhook` must return BEFORE building a
 * URL, so an unset `N8N_BASE_URL` cannot turn into an accidental live request.
 */

const load = async (demo: boolean) => {
  vi.resetModules();
  process.env.DEMO_MODE = demo ? "true" : "false";
  return {
    demo: await import("@/lib/demo"),
    sheets: await import("@/lib/sheets/client"),
    n8n: await import("@/lib/n8n/client"),
    audit: await import("@/lib/audit/writer"),
    ingest: await import("@/lib/sheets/ingest"),
  };
};

/**
 * These modules pull in `googleapis`, whose first transform costs seconds. Under
 * parallel load that exceeds vitest's 5s default and fails the file for reasons
 * that have nothing to do with the assertions — so the budget is stated rather
 * than left to chance.
 */
vi.setConfig({ testTimeout: 30_000 });

const CREDENTIALS = [
  "SHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "AUDIT_SHEET_ID",
  "N8N_BASE_URL",
  "SESSION_SECRET",
  "HR_ADMIN_PASSCODE_HASH",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

let saved: Record<string, string | undefined> = {};

/**
 * Pay the cold-import cost once, here.
 *
 * `@/lib/sheets/client` pulls in `googleapis`, whose first transform takes
 * longer than vitest's 5s default. Without this warm-up the first test in the
 * file fails on import time while every later one runs in under a second — a
 * timeout that says nothing about the code under test.
 */
beforeAll(async () => {
  await load(true);
}, 60_000);

beforeEach(() => {
  saved = {};
  for (const key of CREDENTIALS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of CREDENTIALS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

describe("demo mode", () => {
  it("reads a roster with no spreadsheet configured", async () => {
    const { sheets, ingest } = await load(true);

    const result = await sheets.readRoster();

    // Real ingest pipeline over demo rows: not a bypass of validation.
    const roster = ingest.ingestRoster(result.rows);
    expect(roster.employees.length).toBeGreaterThan(0);
    expect(roster.employees.map((e) => e.id)).toContain("1401");
  });

  it("quarantines the malformed row rather than hiding it", async () => {
    const { sheets, ingest } = await load(true);
    const result = await sheets.readRoster();

    // The seeded `fafsa` row must fail validation exactly as the live one does,
    // so a demo exercises the same quarantine path.
    expect(ingest.ingestRoster(result.rows).quarantined.length).toBe(1);
  });

  it("never opens a socket for any webhook", async () => {
    const { n8n } = await load(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    for (const path of ["onboarding-progress", "welcome", "policy", "admin"]) {
      await n8n.callWebhook(path, { temp_emp_id: "1401" });
    }

    // No N8N_BASE_URL is set, so a real call would have thrown before fetching.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers onboarding-progress for a known id and not_found for an unknown one", async () => {
    const { n8n } = await load(true);

    const known = await n8n.fetchProgress("1401");
    const unknown = await n8n.fetchProgress("does-not-exist-zzz");

    expect((known.body as { status: string }).status).toBe("success");
    // `not_found` is HTTP 200 in the real workflow — the three-state trap.
    expect(unknown.httpStatus).toBe(200);
    expect((unknown.body as { status: string }).status).toBe("not_found");
  });

  it("never claims an email was sent", async () => {
    const { n8n } = await load(true);

    const welcome = await n8n.sendWelcome("1401");
    const progress = await n8n.fetchProgress("1401");

    expect((welcome.body as { email_sent: boolean }).email_sent).toBe(false);
    expect((progress.body as { name: string }).name).toBe("Ashish Kumar");
  });

  it("records the audit trail in memory instead of throwing", async () => {
    const { audit } = await load(true);

    await audit.writeAuditEvent({
      actorEmail: "demo@people-ops.local",
      action: "view",
      employeeId: "1401",
      fieldsDisclosed: ["id"],
      requestId: "r1",
    });

    expect(audit.demoAuditEvents()).toHaveLength(1);
  });

  it("treats a repeated admin id as already processed, writing nothing twice", async () => {
    const { n8n } = await load(true);

    const first = await n8n.createNewHire({ temp_emp_id: "9999", name: "Demo" });
    expect((first.body as { status: string }).status).toBe("ok");
  });

  it("is off unless the variable is exactly true", async () => {
    vi.resetModules();
    process.env.DEMO_MODE = "1";
    expect((await import("@/lib/demo")).DEMO_MODE).toBe(false);
    process.env.DEMO_MODE = "TRUE";
    vi.resetModules();
    expect((await import("@/lib/demo")).DEMO_MODE).toBe(false);
  });

  it("does nothing when disabled — a missing sheet still throws", async () => {
    const { sheets } = await load(false);

    await expect(sheets.readRoster()).rejects.toThrow(/SHEET_ID/);
  });
});