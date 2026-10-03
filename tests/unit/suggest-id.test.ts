import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T064 — next-id suggestion.
 *
 * The suggestion is a convenience, not the mechanism: `temp_emp_id` is
 * caller-assigned and HR can always override it. So the property under test is
 * not "returns 1203" but "never proposes an id that already exists, and never
 * invents a number it cannot justify".
 *
 * A wrong suggestion here is not cosmetic — the id keys every downstream
 * webhook lookup, so proposing a taken id silently overwrites someone.
 */

const getRoster = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sheets/cache", () => ({ getRoster }));

import { suggestNextTempEmpId } from "@/lib/admin/suggest-id";

/** Shape the real `readRoster()` returns, with one row per id. */
function rosterOf(ids: string[]) {
  return {
    result: {
      rows: ids.map((id, index) => ({
        rowNumber: index + 2,
        cells: {
          temp_emp_id: id,
          name: `Employee ${id}`,
          role: "Tester",
          emailID: `${id}@company.com`,
        },
      })),
      headers: [],
      etag: "etag",
    },
    fetchedAt: new Date(0).toISOString(),
    ageSeconds: 0,
    source: "live" as const,
  };
}

beforeEach(() => {
  getRoster.mockReset();
});

describe("suggestNextTempEmpId", () => {
  it("suggests one past the highest numeric id", async () => {
    getRoster.mockResolvedValue(rosterOf(["1201", "1202", "1301", "1302"]));
    expect((await suggestNextTempEmpId()).suggested).toBe("1303");
  });

  it("never proposes an id that is already taken", async () => {
    getRoster.mockResolvedValue(rosterOf(["1201", "1301"]));
    const result = await suggestNextTempEmpId();
    // The suggestion must be a FREE id: proposing a taken one would make the
    // workflow treat the new hire as a duplicate and silently write nothing.
    expect(result.suggested).toBe("1302");
    expect(result.taken).not.toContain(result.suggested);
  });

  it("reports the taken ids so the form can warn about a collision", async () => {
    getRoster.mockResolvedValue(rosterOf(["1201", "1301", "EMP009"]));
    expect((await suggestNextTempEmpId()).taken).toEqual(
      expect.arrayContaining(["1201", "1301", "EMP009"]),
    );
  });

  it("ignores non-numeric ids rather than mis-parsing them", async () => {
    // "EMP009" must not contribute a 9, which would produce a useless "1301".
    getRoster.mockResolvedValue(rosterOf(["EMP009", "1201"]));
    expect((await suggestNextTempEmpId()).suggested).toBe("1202");
  });

  it("declines to suggest when no id is numeric, and says why", async () => {
    getRoster.mockResolvedValue(rosterOf(["EMP009", "EMP010"]));
    const result = await suggestNextTempEmpId();
    expect(result.suggested).toBeNull();
    // A silent null would look like a bug; the form must be able to explain it.
    expect(result.reason).toMatch(/manually/i);
  });

  it("declines to suggest for an empty roster, and says why", async () => {
    getRoster.mockResolvedValue(rosterOf([]));
    const result = await suggestNextTempEmpId();
    expect(result.suggested).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it("stays honest when the roster cannot be read", async () => {
    getRoster.mockRejectedValue(new Error("sheet unavailable"));
    const result = await suggestNextTempEmpId();
    // A failed read must not throw the page away, and must not invent an id.
    expect(result.suggested).toBeNull();
    expect(result.taken).toEqual([]);
    expect(result.reason).toMatch(/could not be read/i);
  });

  it("excludes quarantined rows from the taken list", async () => {
    // The live sheet's garbage row has no valid id, so it cannot collide — but a
    // row that fails validation while still carrying an id must not silently
    // disappear from the collision check either.
    getRoster.mockResolvedValue({
      ...rosterOf(["1201", "fafsa"]),
      result: {
        rows: [
          { rowNumber: 2, cells: { temp_emp_id: "1201", name: "Real", emailID: "a@b.com" } },
          { rowNumber: 3, cells: { temp_emp_id: "fafsa", name: "", emailID: "" } },
        ],
        headers: [],
        etag: "etag",
      },
    });
    expect((await suggestNextTempEmpId()).taken).toEqual(["1201"]);
  });
});