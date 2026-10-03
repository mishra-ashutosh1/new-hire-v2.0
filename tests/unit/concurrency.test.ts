import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/n8n/client";

/**
 * T-M10 — `mapWithConcurrency` MUST return results in INPUT order.
 *
 * `/api/tracker` correlates `settled[index]` with `employees[index]` to attach a
 * person's name, role, cohort, email and start date to their progress result.
 * There is no other link between the two arrays. If the results ever came back
 * in completion order instead, every HR user would see other employees' PII
 * attributed to the wrong person — a silent misattribution across the entire
 * roster, not a rendering glitch.
 *
 * A naive `promiseArray.push(result)` implementation passes a same-speed test
 * and fails this one, so the timings are deliberately uneven.
 */
describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    // First three are slowest, so completion order is the REVERSE of input
    // order for the first slice and interleaved afterwards.
    const delays: Record<string, number> = { a: 40, b: 30, c: 20, d: 5, e: 10, f: 1 };

    const settled = await mapWithConcurrency(items, 2, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, delays[item]));
      return item.toUpperCase();
    });

    expect(settled.map((r) => r.status)).toEqual(items.map(() => "fulfilled"));
    expect(settled.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual(
      items.map((i) => i.toUpperCase()),
    );
  });

  it("places a rejected worker at its OWN index, not at the end", async () => {
    const items = ["ok1", "boom", "ok2", "boom2"];
    const settled = await mapWithConcurrency(items, 4, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item.startsWith("boom") ? 20 : 1));
      if (item.startsWith("boom")) throw new Error(item);
      return item;
    });

    expect(settled).toHaveLength(items.length);
    expect(settled.map((r) => r.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
      "rejected",
    ]);

    const first = settled[1] as PromiseRejectedResult;
    expect(first.reason instanceof Error ? first.reason.message : null).toBe("boom");
  });

  it("respects the concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("returns an empty array for an empty input", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});