import { expect, test } from "@playwright/test";

/**
 * T076 — authorization (FR-023).
 *
 * These tests call the ROUTES DIRECTLY. A hidden nav item is presentation, not
 * access control: anyone can type a URL, and a client-side role check is
 * bypassed with a single curl. What matters is that the server refuses.
 *
 * ⚠️ The role here is asserted from a test-only session header. That header is
 * a STUB for the real identity provider. If it is ever honoured in
 * production, authorization becomes advisory and this suite becomes theatre —
 * see the `NODE_ENV` guard note in tests/e2e/helpers/session.ts.
 */

import { issueTestSession } from "./helpers/session";

test.describe("new_hire role", () => {
  /*
   * Module access is NOT record access. `new_hire` IS permitted onto the
   * tracker module — they need to see their own onboarding — so a blanket 403
   * would be the wrong assertion. What must hold is that the response contains
   * ONLY their own record.
   */

  test("sees only their own record on the tracker", async ({ request }) => {
    const response = await request.get("/api/tracker", {
      headers: { cookie: await issueTestSession({ role: "new_hire", selfId: "1201" }) },
    });

    // Not 401/403 — the module is open to them.
    expect([401, 403]).not.toContain(response.status());

    // If the roster was reachable, exactly one row may come back, and it must
    // be theirs. Without upstream credentials this environment returns 502
    // before any rows exist, which is also an acceptable non-disclosure.
    if (response.status() === 200) {
      const body = await response.json();
      const ids = (body.rows ?? []).map((r: { employee: { id: string } }) => r.employee.id);
      expect(new Set(ids)).toEqual(new Set(["1201"]));
    }
  });

  test("is refused an employee detail that is not their own", async ({ request }) => {
    const response = await request.get("/api/tracker/9999", {
      headers: { cookie: await issueTestSession({ role: "new_hire", selfId: "1201" }) },
    });
    expect(response.status()).toBe(403);
  });

  test("may read their own detail", async ({ request }) => {
    const response = await request.get("/api/tracker/1201", {
      headers: { cookie: await issueTestSession({ role: "new_hire", selfId: "1201" }) },
    });
    // Scope passed; upstream availability determines the rest.
    expect([401, 403]).not.toContain(response.status());
  });

  test("is refused the welcome console", async ({ request }) => {
    const response = await request.get("/api/welcome", {
      headers: { cookie: await issueTestSession({ role: "new_hire" }) },
    });
    expect(response.status()).toBe(403);
  });

  test("is refused provisioning", async ({ request }) => {
    const response = await request.post("/api/admin/new-hire", {
      headers: { cookie: await issueTestSession({ role: "new_hire" }) },
      data: { name: "Probe", email: "probe@example.com", start_date: "2026-10-01" },
    });
    // 403 for the role, not 503 for the unverified contract — the role check
    // must run FIRST, or an unauthorized caller learns about the contract.
    expect(response.status()).toBe(403);
  });

  test("is refused a stage update", async ({ request }) => {
    const response = await request.post("/api/tracker/1201/stage", {
      headers: { cookie: await issueTestSession({ role: "new_hire" }) },
      data: { stage: "hr_interview" },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe("manager role", () => {
  test("is refused provisioning", async ({ request }) => {
    const response = await request.post("/api/admin/new-hire", {
      headers: {
        cookie: await issueTestSession({ role: "manager", scopedEmployeeIds: ["1201"] }),
      },
      data: { name: "Probe", email: "probe@example.com", start_date: "2026-10-01" },
    });
    expect(response.status()).toBe(403);
  });

  test("is refused an employee outside their reporting line", async ({ request }) => {
    const response = await request.get("/api/tracker/9999", {
      headers: {
        cookie: await issueTestSession({ role: "manager", scopedEmployeeIds: ["1201"] }),
      },
    });
    expect(response.status()).toBe(403);
  });

  test("sees only their reporting line on the tracker", async ({ request }) => {
    const response = await request.get("/api/tracker", {
      headers: {
        cookie: await issueTestSession({ role: "manager", scopedEmployeeIds: ["1201"] }),
      },
    });

    expect([401, 403]).not.toContain(response.status());

    if (response.status() === 200) {
      const body = await response.json();
      const ids = (body.rows ?? []).map((r: { employee: { id: string } }) => r.employee.id);
      // Every returned employee must be in scope, and nothing else.
      for (const id of ids) expect(["1201"]).toContain(id);
    }
  });
});

test.describe("unauthenticated callers", () => {
  for (const route of ["/api/tracker", "/api/tracker/1201", "/api/welcome"]) {
    test(`${route} requires a session`, async ({ request }) => {
      const response = await request.get(route);
      expect([401, 403]).toContain(response.status());
    });
  }

  test("provisioning requires a session", async ({ request }) => {
    const response = await request.post("/api/admin/new-hire", {
      data: { name: "Probe", email: "probe@example.com", start_date: "2026-10-01" },
    });
    expect([401, 403]).toContain(response.status());
  });
});

test.describe("forgery resistance", () => {
  test("actor_email cannot be supplied by the client", async ({ request }) => {
    // Even hr_admin must not be able to forge the audit actor. The actor comes
    // from the verified session, never the body (FR-025).
    const response = await request.post("/api/admin/new-hire", {
      headers: {
        cookie: await issueTestSession({ role: "hr_admin", email: "real.hr@company.com" }),
      },
      data: {
        name: "Probe",
        email: "probe@example.com",
        start_date: "2026-10-01",
        actor_email: "ceo@company.com",
        actorEmail: "ceo@company.com",
      },
    });

    const body = await response.text();
    expect(body).not.toContain("ceo@company.com");
  });

  test("an employee id outside the payload schema is rejected", async ({ request }) => {
    const response = await request.post("/api/admin/new-hire", {
      headers: { cookie: await issueTestSession({ role: "hr_admin" }) },
      data: {
        name: "Probe",
        email: "probe@example.com",
        start_date: "2026-10-01",
        // The BFF must assign ids, never accept them.
        temp_emp_id: "9999",
        totalEssentials: 999,
      },
    });
    // Rejected by validation (400) or ignored — never 2xx.
    expect(response.ok()).toBe(false);
  });
});
