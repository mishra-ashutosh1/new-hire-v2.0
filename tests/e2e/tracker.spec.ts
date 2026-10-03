import { expect, test } from "@playwright/test";
import { authenticate } from "./helpers/session";

/**
 * T029 — no blank panels (SC-001, FR-019).
 *
 * A blank panel is the failure mode this whole feature exists to prevent. It
 * looks like a working page: no error, no stack trace, just an empty box where
 * a person's onboarding status should be. A user who trusts a blank panel
 * believes someone who is not onboarded is fully onboarded.
 *
 * Every DataState container must carry either content or an explicit message.
 */

const ROUTES = ["/", "/tracker", "/policies", "/welcome", "/new-hire"];
const VIEWPORTS = [
  { name: "mobile", width: 360, height: 740 },
  { name: "desktop", width: 1280, height: 900 },
];

/** A tracker response mixing every logical row state. */
function trackerFixture() {
  const rows = [
    {
      state: "success",
      id: "1201",
      message: "",
      data: {
        tempEmpId: "1201",
        name: "Ashish Kumar",
        role: "Developer - Lead",
        stage: "it_setup",
        stageStatus: "welcome_sent",
        percentComplete: 66,
        completedCount: 2,
        totalItems: 3,
        completed: ["welcome_email", "laptop"],
        outstanding: ["it_provisioning"],
        canUpdateStage: true,
        requestedStageUpdate: false,
      },
      employee: {
        id: "1201",
        name: "Ashish Kumar",
        role: "Developer - Lead",
        startDate: "2026-09-30",
        cohort: "3",
        email: "acm5520@gmail.com",
        totalEssentials: 3,
        stage: null,
        stageStatus: null,
      },
    },
    {
      state: "not_found",
      id: "1202",
      message: "No onboarding record exists for this employee yet.",
      data: null,
      employee: {
        id: "1202",
        name: "Priya Nair",
        role: "Developer",
        startDate: "2026-10-05",
        cohort: "4",
        email: "priya.nair@company.com",
        totalEssentials: 3,
        stage: null,
        stageStatus: null,
      },
    },
    {
      state: "error",
      id: "1203",
      message: "Upstream progress request failed (HTTP 503).",
      data: null,
      employee: {
        id: "1203",
        name: "Rahul Verma",
        role: "QA Engineer",
        startDate: "2026-10-07",
        cohort: "4",
        email: "rahul.verma@company.com",
        totalEssentials: 3,
        stage: null,
        stageStatus: null,
      },
    },
  ];

  return {
    rows,
    rosterFreshness: { fetchedAt: new Date().toISOString(), ageSeconds: 3, source: "live" },
    quarantined: { count: 1, rowNumbers: [9] },
    generatedAt: new Date().toISOString(),
    rowTimeoutMs: 10000,
  };
}

for (const route of ROUTES) {
  for (const viewport of VIEWPORTS) {
    test(`${route} renders no blank panel at ${viewport.name}`, async ({ page }) => {
      await authenticate(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      // Serve deterministic data so the assertion is about the COMPONENT, not
      // about whether an upstream happened to be reachable.
      await page.route("**/api/tracker", (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(trackerFixture()) }),
      );

      await page.goto(route, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);

      // Every DataState container must be either filled or explicitly empty.
      const blanks = await page.evaluate(() => {
        const results: string[] = [];
        for (const el of Array.from(document.querySelectorAll("[data-state]"))) {
          const state = el.getAttribute("data-state");
          const label = el.getAttribute("data-label") ?? "?";
          const text = (el.textContent ?? "").trim();
          // sr-only text still counts as present for a screen reader, but a
          // loading state legitimately has only the live region.
          if (text.length === 0) {
            results.push(`[${state}] for "${label}" rendered with no text at all`);
          }
          // A success state with nothing in it is the silent failure.
          if (state === "success" && text.length === 0) {
            results.push(`success state for "${label}" is blank`);
          }
        }
        return results;
      });

      expect(blanks, `${route} at ${viewport.width}px has blank panels:\n${blanks.join("\n")}`).toEqual([]);
    });
  }
}

test("an error panel states what failed rather than showing nothing", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/tracker", (r) =>
    r.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "ROSTER_UNAVAILABLE", message: "Employee roster is unreachable." },
      }),
    }),
  );

  await page.goto("/tracker", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const panel = page.locator('[data-state="error"]');
  await expect(panel).toBeVisible();
  // The BFF's explanation must survive to the user, not just a status code:
  // "roster unreachable" (retry later) and "audit unavailable" (escalate) are
  // both HTTP failures and require different responses.
  await expect(panel).toContainText(/roster|unreachable/i);

  // A retry affordance is required — an error the user cannot act on is a dead
  // end, not an error message.
  await expect(panel.getByRole("button", { name: /retry|try again/i })).toBeVisible();
});

test("a loading panel is not mistaken for an empty one", async ({ page }) => {
  await authenticate(page);

  // Never resolve, so the page stays in its loading state.
  await page.route("**/api/tracker", () => new Promise(() => {}));

  await page.goto("/tracker", { waitUntil: "domcontentloaded" });

  const loading = page.locator('[data-state="loading"]');
  await expect(loading).toBeVisible();
  // Marked busy for assistive technology.
  await expect(loading).toHaveAttribute("aria-busy", "true");
  // A skeleton must occupy space, so the page does not jump when data lands.
  expect((await loading.boundingBox())?.height ?? 0).toBeGreaterThan(40);
});
