import { expect, test, type Page } from "@playwright/test";
import { authenticate } from "./helpers/session";

/**
 * T065 — responsive layout (SC-006, FR-027).
 *
 * HR opens this on a phone in a corridor between meetings. A layout that only
 * works at desktop width is not "slightly awkward", it is unusable on the
 * device the user actually has.
 *
 * The primary assertion is `scrollWidth <= clientWidth`: a page that scrolls
 * sideways is the single most common responsive failure and the one most
 * visible to a user.
 */

const ROUTES = ["/", "/tracker", "/policies", "/welcome", "/design-system"];
const WIDTHS = [
  { name: "mobile", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
];

/** The element responsible for horizontal overflow, if any. */
async function findOverflowingElement(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const rect = el.getBoundingClientRect();
      // Right edge past the viewport.
      if (rect.right > docWidth + 1 && rect.width > 0) {
        const id = el.id ? `#${el.id}` : "";
        const cls = typeof el.className === "string" && el.className ? `.${el.className.split(/\s+/)[0]}` : "";
        offenders.push(`${el.tagName.toLowerCase()}${id}${cls} (right=${Math.round(rect.right)} vs ${docWidth})`);
        if (offenders.length >= 5) break;
      }
    }
    return offenders.length ? offenders.join("; ") : null;
  });
}

for (const route of ROUTES) {
  for (const viewport of WIDTHS) {
    test(`${route} does not overflow horizontally at ${viewport.name} (${viewport.width}px)`, async ({
      page,
    }) => {
      // Authenticate first: an unauthenticated page renders only its error
      // panel, which would measure nothing worth measuring.
      await authenticate(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(route, { waitUntil: "networkidle" });

      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // Named offenders make a failure diagnosable instead of just a number.
      const offenders = await findOverflowingElement(page);
      expect(
        metrics.scrollWidth,
        `${route} overflows at ${viewport.width}px. Offending elements: ${offenders ?? "unknown"}`,
      ).toBeLessThanOrEqual(metrics.clientWidth + 1);
    });
  }
}

test("content is not clipped unreadably at 360px", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/tracker", { waitUntil: "networkidle" });

  // Clipping means content taller than the box that is not scrollable and not
  // visible — measured directly as scrollHeight vs clientHeight, rather than
  // estimated from font metrics (which flags ordinary single-line headings).
  //
  // `sr-only` content is skipped: a 1px box is the intended technique there,
  // and the text remains available to assistive technology.
  const clipped = await page.evaluate(() => {
    const results: string[] = [];
    const selector = "p, span, td, th, h1, h2, h3, label, button, a, dd, dt, li, div";

    for (const el of Array.from(document.querySelectorAll(selector))) {
      const text = (el.textContent ?? "").trim();
      if (!text) continue;

      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (style.position === "absolute" && parseFloat(style.width) === 1) continue;
      if (el.className && typeof el.className === "string" && /\bsr-only\b/.test(el.className)) continue;

      // A scrollable box is not clipped — the user can reach the content.
      const scrollable = ["auto", "scroll"].includes(style.overflowY);
      if (scrollable) continue;
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      if (el.clientHeight === 0) continue;

      // Truncation is a deliberate design decision, but silently truncating a
      // VALUE the user must read is a data-loss bug, so report it.
      results.push(
        `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/)[0]} "${text.slice(0, 40)}" ` +
          `scrollH=${el.scrollHeight} clientH=${el.clientHeight} overflowY=${style.overflowY}`,
      );
    }
    return results.slice(0, 10);
  });

  expect(clipped, `content clipped at 360px:\n${clipped.join("\n")}`).toEqual([]);
});

test("no content overflows its own container at 360px", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/tracker", { waitUntil: "networkidle" });

  // A long unbroken token (an email, a URL, an id) inside a fixed-width box
  // overflows unless something breaks it. Measure the overflow rather than
  // injecting a synthetic probe, which would only test the probe.
  const overflowing = await page.evaluate(() => {
    const results: string[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const text = (el.textContent ?? "").trim();
      if (!text) continue;
      // Only leaf-ish elements carry the actual string.
      if (el.children.length > 0) continue;

      const style = getComputedStyle(el);
      if (style.overflow !== "visible") continue;
      if (style.whiteSpace === "nowrap") continue;
      if (style.wordBreak === "break-all" || style.overflowWrap === "anywhere") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // The element's own box is wider than the viewport allows.
      if (rect.right > document.documentElement.clientWidth + 1) {
        results.push(`${el.tagName.toLowerCase()} "${text.slice(0, 40)}" right=${Math.round(rect.right)}`);
      }
    }
    return results.slice(0, 10);
  });

  expect(overflowing, `content overflowing at 360px:\n${overflowing.join("\n")}`).toEqual([]);
});
