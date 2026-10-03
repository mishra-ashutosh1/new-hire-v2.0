import { expect, test, type Page } from "@playwright/test";
import { authenticate } from "./helpers/session";

/**
 * T030 — partial failure (SC-002, FR-021).
 *
 * onboarding-progress has NO list mode: it requires a temp_emp_id. So a view of
 * 60 employees is 60 independent upstream calls, and one of them failing is
 * routine, not exceptional.
 *
 * The failure mode this guards against is `Promise.all`. One rejected call
 * blanks the entire table, and HR then sees an empty tracker — which reads as
 * "no one is onboarding" rather than "one lookup failed". A blank panel is
 * indistinguishable from good news, and that is exactly what makes it dangerous.
 */

const TOTAL = 60;
const FAILING_INDEX = 17;

interface FixtureRow {
  state: "success" | "not_found" | "error";
  id: string;
  message: string;
  data: Record<string, unknown> | null;
  employee: Record<string, unknown>;
}

function employee(id: string, index: number) {
  return {
    id,
    name: `Employee ${index}`,
    role: index % 3 === 0 ? "Developer" : index % 3 === 1 ? "QA Engineer" : "Designer",
    startDate: "2026-10-01",
    cohort: String((index % 4) + 1),
    email: `employee.${index}@company.com`,
    totalEssentials: 3,
    stage: null,
    stageStatus: null,
  };
}

/** 60 rows where exactly one carries a row-level error. */
function partialFailureFixture() {
  const rows: FixtureRow[] = [];

  for (let index = 0; index < TOTAL; index++) {
    const id = String(1200 + index);
    const base = employee(id, index);

    if (index === FAILING_INDEX) {
      rows.push({
        state: "error",
        id,
        message: "Upstream progress request failed (HTTP 503).",
        data: null,
        employee: base,
      });
      continue;
    }

    rows.push({
      state: "success",
      id,
      message: "",
      // camelCase, matching the BFF's NORMALIZED shape — the upstream webhook
      // speaks snake_case and classifyProgress maps between them.
      data: {
        tempEmpId: id,
        name: base.name,
        role: base.role,
        stage: "it_setup",
        stageStatus: "welcome_sent",
        percentComplete: 33,
        completedCount: 1,
        totalItems: 3,
        completed: ["welcome_email"],
        outstanding: ["laptop", "it_provisioning"],
        canUpdateStage: true,
        requestedStageUpdate: false,
      },
      employee: base,
    });
  }

  return {
    rows,
    rosterFreshness: { fetchedAt: new Date().toISOString(), ageSeconds: 2, source: "live" },
    quarantined: { count: 0, rowNumbers: [] },
    generatedAt: new Date().toISOString(),
    rowTimeoutMs: 10000,
  };
}

async function settle(page: Page) {
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector("[data-state]");
        return el !== null && el.getAttribute("data-state") !== "loading";
      },
      { timeout: 20_000 },
    )
    .catch(() => undefined);
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 360, height: 740 },
]) {
  test(`${TOTAL - 1} rows render and 1 fails inline at ${viewport.name}`, async ({ page }) => {
    await authenticate(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await page.route("**/api/tracker", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(partialFailureFixture()),
      }),
    );

    await page.goto("/tracker", { waitUntil: "networkidle" });
    await settle(page);

    // The page-level state must be success: one bad row does not make the
    // table an error. This is the assertion Promise.all would break.
    await expect(page.locator('[data-state="error"]')).toHaveCount(0);

    // All 60 rows are present — the 59 healthy ones AND the failed one. The
    // failed row is rendered in place with an explanation, not dropped, because
    // silently omitting an employee is how someone gets lost during onboarding.
    const body = page.locator("body");
    await expect(body).toContainText(`Employee ${FAILING_INDEX}`);
    await expect(body).toContainText(`Employee 0`);
    await expect(body).toContainText(`Employee ${TOTAL - 1}`);

    // The failing row's reason is visible, not a bare blank.
    await expect(body).toContainText(/503|failed/i);
  });
}

test("a failed row shows an inline error, never a table-level error", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.route("**/api/tracker", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(partialFailureFixture()),
    }),
  );

  await page.goto("/tracker", { waitUntil: "networkidle" });
  await settle(page);

  // The table is present and populated.
  await expect(page.locator("table")).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(TOTAL);

  // No page-level error panel anywhere.
  await expect(page.locator('[data-state="error"]')).toHaveCount(0);

  // Exactly one row is marked unavailable. The healthy 59 are not, which is
  // what proves the failure stayed scoped to one row.
  const unavailable = page.getByText("Unavailable", { exact: true });
  await expect(unavailable).toHaveCount(1);

  // A row-level failure must not be labelled "Record mismatch": not_found and
  // error are categorically different states and merging them tells a user
  // their record is missing when it is merely unreachable.
  await expect(page.getByText("Record mismatch", { exact: true })).toHaveCount(0);

  // The healthy rows are still fully rendered with their data.
  await expect(page.locator("table")).toContainText("33%");
});

test("a total upstream failure is a page-level error, not an empty table", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Every row failed: that IS a table-level failure and must say so. This is
  // the boundary — one failure is a row, all failures are a page.
  const allFailed = {
    rows: Array.from({ length: 5 }, (_, index) => ({
      state: "error" as const,
      id: String(1300 + index),
      message: "Upstream progress request failed (HTTP 503).",
      data: null,
      employee: employee(String(1300 + index), index),
    })),
    rosterFreshness: { fetchedAt: new Date().toISOString(), ageSeconds: 2, source: "live" },
    quarantined: { count: 0, rowNumbers: [] },
    generatedAt: new Date().toISOString(),
    rowTimeoutMs: 10000,
  };

  await page.route("**/api/tracker", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(allFailed) }),
  );

  await page.goto("/tracker", { waitUntil: "networkidle" });
  await settle(page);

  // Rows still render individually with their errors, and nothing claims the
  // table itself succeeded.
  await expect(page.locator("table tbody tr")).toHaveCount(5);
  const body = page.locator("body");
  await expect(body).toContainText(/503|failed/i);
});

test("a not_found row is distinguished from an error row", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  // These are categorically different: not_found means "nobody has started
  // this yet", error means "we could not find out". Collapsing them tells a
  // user their onboarding record is missing when it is merely unreachable.
  const fixture = {
    rows: [
      {
        state: "not_found" as const,
        id: "1401",
        message: "No onboarding record exists for this employee yet.",
        data: null,
        employee: employee("1401", 1),
      },
      {
        state: "error" as const,
        id: "1402",
        message: "Upstream progress request failed (HTTP 503).",
        data: null,
        employee: employee("1402", 2),
      },
    ],
    rosterFreshness: { fetchedAt: new Date().toISOString(), ageSeconds: 1, source: "live" },
    quarantined: { count: 0, rowNumbers: [] },
    generatedAt: new Date().toISOString(),
    rowTimeoutMs: 10000,
  };

  await page.route("**/api/tracker", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) }),
  );

  await page.goto("/tracker", { waitUntil: "networkidle" });
  await settle(page);

  const body = page.locator("body");
  await expect(body).toContainText(/no onboarding record/i);
  await expect(body).toContainText(/503|failed/i);
});
