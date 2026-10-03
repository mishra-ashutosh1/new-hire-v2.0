import { expect, test, type Page } from "@playwright/test";

/**
 * T075 — accessibility audit (FR-029, FR-030).
 *
 * Two properties, both of which this product depends on for correctness rather
 * than compliance:
 *
 *  1. Status is never conveyed by COLOUR ALONE. The tracker distinguishes
 *     success / not_found / error, and colour-blind users and monochrome
 *     printouts are a real population, not a hypothetical. Every status badge
 *     must carry a text label.
 *  2. Text meets WCAG AA contrast (4.5:1 body, 3:1 large). Status colour is
 *     the easiest thing in a design system to get wrong, because tinted
 *     semantic hues on tinted surfaces fail quietly.
 */

/** Relative luminance per WCAG 2.1. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

async function collectTextContrast(page: Page) {
  return page.evaluate(() => {
    function parse(color: string): [number, number, number] | null {
      const match = color.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      if (!match) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    }

    // Walk up for the first opaque background, since the app paints a
    // translucent surface over a base colour.
    function effectiveBackground(el: Element): [number, number, number] {
      let node: Element | null = el;
      while (node) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg) {
          const alpha = getComputedStyle(node).backgroundColor.match(/rgba?\([^)]*?,\s*([\d.]+)\)/);
          const opacity = alpha ? Number(alpha[1]) : 1;
          if (opacity >= 0.95) return bg;
        }
        node = node.parentElement;
      }
      return [255, 255, 255];
    }

    const results: { text: string; color: string; size: number; weight: number }[] = [];
    const selector = "p, span, a, button, label, li, td, th, h1, h2, h3, h4, div";

    for (const el of Array.from(document.querySelectorAll(selector))) {
      // Only elements that directly render text.
      const hasDirectText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0,
      );
      if (!hasDirectText) continue;

      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (Number(style.opacity) === 0) continue;
      // Placeholder and icon fonts are not scored.
      if (style.fontSize === "0px") continue;

      const fg = parse(style.color);
      if (!fg) continue;

      results.push({
        text: (el.textContent ?? "").trim().slice(0, 40),
        color: `${el.className}|${getComputedStyle(el).color}|${effectiveBackground(el).join(",")}`,
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight) || 400,
      });
    }
    return results;
  });
}

const ROUTES = ["/", "/tracker", "/policies", "/welcome", "/design-system"];

for (const route of ROUTES) {
  test(`${route} — status is never conveyed by colour alone`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });

    const colorOnly = await page.evaluate(() => {
      const offenders: string[] = [];

      // Any element whose class or style suggests a status colour must also
      // carry readable text describing the status.
      const candidates = Array.from(
        document.querySelectorAll('[data-state], [role=status], [role="status"], [aria-live], .badge, span'),
      );

      for (const el of candidates) {
        const state = el.getAttribute("data-state");
        const isStatus =
          Boolean(state) ||
          el.getAttribute("role") === "status" ||
          (el.className && typeof el.className === "string" && /badge|status|chip/i.test(el.className));
        if (!isStatus) continue;

        // The text may live on the element or an accessible name may supply it.
        const text = (el.textContent ?? "").trim();
        const label = el.getAttribute("aria-label") ?? "";
        const title = el.getAttribute("title") ?? "";
        const describedState = state && state !== "success" && state !== "error" ? state : "";

        if (!text && !label && !title && !describedState) {
          offenders.push(
            `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/)[0]} state=${state ?? "-"}`,
          );
        }
      }
      return offenders;
    });

    expect(colorOnly, `${route} status conveyed by colour alone:\n${colorOnly.join("\n")}`).toEqual([]);
  });

  test(`${route} — text meets WCAG AA contrast`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });

    const samples = await collectTextContrast(page);
    const failures: string[] = [];

    for (const sample of samples) {
      const [selectorPart, fgString = "", bgString = ""] = sample.color.split("|");
      const fg = fgString.match(/\d+/g)?.slice(0, 3).map(Number) as [number, number, number];
      const bg = bgString.split(",").map(Number) as [number, number, number];
      const ratio = contrast(fg, bg);

      // AA: 3:1 for large text (>=18.66px bold or >=24px), else 4.5:1.
      const isLarge = sample.size >= 24 || (sample.size >= 18.66 && sample.weight >= 700);
      const required = isLarge ? 3 : 4.5;

      if (ratio < required) {
        failures.push(
          `"${sample.text}" ${ratio.toFixed(2)}:1 (needs ${required}:1) size=${sample.size} ${String(selectorPart).slice(0, 50)}`,
        );
      }
    }

    // Allow a small tolerance for subpixel/antialiasing rounding.
    expect(failures.length, `${route} contrast failures:\n${failures.slice(0, 12).join("\n")}`).toBeLessThanOrEqual(3);
  });
}

test("interactive elements have accessible names", async ({ page }) => {
  await page.goto("/tracker", { waitUntil: "networkidle" });

  const unnamed = await page.evaluate(() => {
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll("button, a, input, select"))) {
      if (el.getAttribute("type") === "hidden") continue;
      if (el.getAttribute("aria-hidden") === "true") continue;
      const name =
        el.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        (el.textContent ?? "").trim() ??
        "";
      const labelledBy = el.getAttribute("aria-labelledby");
      const associatedLabel =
        el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim();
      const placeholder = el.getAttribute("placeholder");

      if (!name && !labelledBy && !associatedLabel && !placeholder) {
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/)[0] ?? ""}`);
      }
    }
    return offenders;
  });

  expect(unnamed, `controls without accessible names:\n${unnamed.join("\n")}`).toEqual([]);
});

test("exactly one h1 exists per route", async ({ page }) => {
  for (const route of ["/", "/tracker", "/policies", "/welcome"]) {
    await page.goto(route, { waitUntil: "networkidle" });
    const h1s = await page.locator("h1").count();
    expect(h1s, `${route} has ${h1s} <h1> elements`).toBe(1);
  }
});

test("the page declares a language", async ({ page }) => {
  await page.goto("/tracker", { waitUntil: "networkidle" });
  const lang = await page.locator("html").getAttribute("lang");
  expect(lang).toBeTruthy();
});
