import { expect, test } from "@playwright/test";
import { authenticate } from "./helpers/session";

/**
 * T066 — touch targets (FR-028).
 *
 * WCAG 2.5.8 requires 24×24px minimum; Apple and Material both specify 44px,
 * and 44 is the number that matters here because HR uses this on a phone one-
 * handed while holding a coffee.
 *
 * Targets are measured from the element's own hit area, not its text, so a
 * small label inside a padded button still passes — which is the correct
 * outcome. What fails is a genuinely small control.
 */

const ROUTES = ["/", "/tracker", "/policies", "/welcome", "/new-hire"];
const MIN_SIZE = 44;

test.describe("touch targets at 360px", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const route of ROUTES) {
    test(`${route} has no interactive target smaller than ${MIN_SIZE}×${MIN_SIZE}`, async ({ page }) => {
      await authenticate(page);
      await page.goto(route, { waitUntil: "networkidle" });

      const offenders = await page.evaluate((min) => {
        const selector = "a[href], button:not([disabled]), input:not([type=hidden]), select, textarea, [role=button], [role=tab]";
        const results: string[] = [];
        for (const el of Array.from(document.querySelectorAll(selector))) {
          const style = getComputedStyle(el);
          // Skip anything not actually perceivable or interactable.
          if (style.display === "none" || style.visibility === "hidden") continue;
          if (Number(style.opacity) === 0) continue;
          // An inline link inside a paragraph is exempt: enlarging it would
          // break the sentence. WCAG 2.5.8 has this exception.
          if (el.tagName === "A" && el.closest("p, li.prose, td") && style.display.startsWith("inline")) continue;

          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.width < min || rect.height < min) {
            const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30);
            results.push(
              `<${el.tagName.toLowerCase()}> "${label}" ${Math.round(rect.width)}×${Math.round(rect.height)}`,
            );
          }
        }
        return results;
      }, MIN_SIZE);

      expect(
        offenders,
        `${route} has sub-${MIN_SIZE}px touch targets:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }

  test("the hamburger trigger is a full-size target", async ({ page }) => {
    await authenticate(page);
    await page.goto("/tracker", { waitUntil: "networkidle" });

    // At mobile width the sidebar is replaced by a drawer, so the nav links
    // are not on the page until it is opened — a closed drawer must not be
    // mistaken for missing navigation.
    const trigger = page.getByTestId("nav-trigger");
    await expect(trigger).toBeVisible();

    const box = await trigger.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(MIN_SIZE);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_SIZE);

    await trigger.click();
    const drawer = page.getByTestId("nav-drawer");
    await expect(drawer).toBeVisible();

    for (const link of await drawer.locator("a").all()) {
      const linkBox = await link.boundingBox();
      expect(linkBox?.height ?? 0, `nav link "${await link.textContent()}" is too short`).toBeGreaterThanOrEqual(
        MIN_SIZE,
      );
    }
  });

  test("Escape closes the drawer and restores focus", async ({ page }) => {
    await authenticate(page);
    await page.goto("/tracker", { waitUntil: "networkidle" });

    const trigger = page.getByTestId("nav-trigger");
    await trigger.click();
    await expect(page.getByTestId("nav-drawer")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("nav-drawer")).toHaveCount(0);

    // Focus must return to the trigger, or the next Tab starts from the top
    // of the document and the user loses their place.
    await expect(trigger).toBeFocused();
  });
});
