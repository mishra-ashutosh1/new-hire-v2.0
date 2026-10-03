import { expect, test, type Page } from "@playwright/test";
import { authenticate } from "./helpers/session";

/**
 * Wait until the tracker's DataState settles.
 *
 * React Query retries with exponential backoff and the gaps between attempts are
 * periods of NO network traffic, so `networkidle` can fire while the query is
 * still pending. Without this wait the mobile assertions pass vacuously against
 * a loading skeleton rather than against real rows.
 */
async function settle(page: Page): Promise<string | null> {
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector("[data-state]");
        return el !== null && el.getAttribute("data-state") !== "loading";
      },
      { timeout: 20_000 },
    )
    .catch(() => undefined);

  return page.evaluate(() => {
    const el = document.querySelector("[data-state]");
    return el ? el.getAttribute("data-state") : null;
  });
}

/**
 * T067 — mobile card rendering (FR-027).
 *
 * A horizontally scrolled table is the default "responsive" outcome and it is
 * the wrong one: on a phone it hides data behind a gesture most users never
 * discover, and it breaks the document flow so the user's mental model of the
 * page stops matching what they see.
 *
 * Below `md` the tables must render as stacked cards instead.
 */

test.describe("tables become cards below md", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const route of ["/tracker", "/welcome"]) {
    test(`${route} renders no <table> at 360px`, async ({ page }) => {
      await authenticate(page);
      await page.goto(route, { waitUntil: "networkidle" });
      await settle(page);

      const visibleTables = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll("table"));
        return tables.filter((t) => {
          const style = getComputedStyle(t);
          return style.display !== "none" && t.getBoundingClientRect().width > 0;
        }).length;
      });

      expect(visibleTables, `${route} still renders a <table> on mobile`).toBe(0);
    });

    test(`${route} renders stacked card items at 360px`, async ({ page }) => {
      await authenticate(page);
      await page.goto(route, { waitUntil: "networkidle" });
      await settle(page);

      // The card list is the data-testid the responsive primitive stamps on
      // each stacked item.
      const cards = page.locator('[data-testid="card-item"]');
      const count = await cards.count();

      // Empty and error states legitimately render no rows; assert a visible
      // DataState panel in that case, so a regression that removes the
      // responsive primitive entirely is still caught.
      const container = page.locator('[data-testid="card-list"]');
      if (count > 0) {
        await expect(container).toBeVisible();
        // Each card is a block-level item, not a side-by-side column.
        const box = await cards.first().boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(280);
      } else {
        // No rows: assert a visible DataState panel rather than a blank page.
        await expect(page.locator("[data-state]").first()).toBeVisible();
      }
    });
  }

  test("the desktop table reappears at 1280px", async ({ page }) => {
    await authenticate(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/tracker", { waitUntil: "networkidle" });
    await settle(page);

    // React Query retries with exponential backoff, and the gaps between
    // attempts are periods of NO network traffic — so `networkidle` can fire
    // while the query is still pending. Wait for the state to actually settle
    // rather than asserting against a half-loaded page.
    const settledState = await settle(page);
    const hasTable = await page.evaluate(() => document.querySelectorAll("table").length > 0);

    // With no Google credentials the roster is unreachable, so the page renders
    // its error panel rather than a table. That is correct behaviour, but it
    // cannot exercise the desktop branch — skip explicitly rather than report a
    // false layout failure.
    test.skip(
      !hasTable && settledState === "error",
      `Roster unavailable — /tracker rendered its "${settledState}" panel instead of rows. ` +
        `Set GOOGLE_SERVICE_ACCOUNT_JSON to exercise the desktop table.`,
    );

    // A responsive primitive that hides the table at every width has not
    // solved the problem, it has just hidden the data.
    expect(
      hasTable,
      `/tracker settled into state="${settledState}" with no table at 1280px. ` +
        `With a reachable roster this branch must render a <table>.`,
    ).toBe(true);
  });

  test("no element scrolls horizontally at 360px", async ({ page }) => {
    await authenticate(page);
    await page.goto("/tracker", { waitUntil: "networkidle" });

    // A table wrapped in `overflow-x-auto` does not overflow the DOCUMENT but
    // is still a horizontally scrolled table. Catch both.
    const scrollable = await page.evaluate(() => {
      const results: string[] = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          const style = getComputedStyle(el);
          if (style.overflowX === "auto" || style.overflowX === "scroll") {
            const cls = typeof el.className === "string" ? el.className.split(/\s+/)[0] : "";
            results.push(`${el.tagName.toLowerCase()}.${cls} (${el.scrollWidth}>${el.clientWidth})`);
          }
        }
      }
      return results;
    });

    expect(
      scrollable,
      `horizontally scrollable containers on mobile:\n${scrollable.join("\n")}`,
    ).toEqual([]);
  });
});
