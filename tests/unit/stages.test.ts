import { describe, it, expect } from "vitest";
import { toDisplayStage, resolveStage, stageRank, STAGE_LABELS } from "@/lib/stages";

describe("toDisplayStage", () => {
  it("resolves the coarse sheet labels observed live on 2026-10-02", () => {
    expect(toDisplayStage("Not Started")).toBe("Not Started");
    expect(toDisplayStage("Completed")).toBe("Complete");
    expect(toDisplayStage("Complete")).toBe("Complete");
  });

  it("keeps unresolved coarse labels verbatim instead of inventing a stage", () => {
    // "In Progress" spans it_setup/orientation/meet_and_greet/task_complete and
    // has no single canonical equivalent, so it must NOT be guessed at.
    expect(toDisplayStage("In Progress")).toBe("In Progress");
    expect(toDisplayStage("in progress")).toBe("in progress");
  });

  it("renders EVERY token of a multi-value chips cell", () => {
    // Row 1301 held "Not Started, In Progress". A chips cell is a set, not an
    // ordered log, so there is no defensible token to pick as "the" stage and
    // none may be dropped.
    expect(toDisplayStage("Not Started, In Progress")).toBe("Not Started, In Progress");
    expect(toDisplayStage("Not Started, In Progress, Completed")).toBe(
      "Not Started, In Progress, Complete",
    );
  });

  it("de-duplicates repeated tokens, including after resolution", () => {
    expect(toDisplayStage("Not Started, not started")).toBe("Not Started");
    expect(toDisplayStage("Completed, completed")).toBe("Complete");
  });

  it("resolves the Admin workflow's 'Day 0' default", () => {
    expect(toDisplayStage("Day 0")).toBe("Not Started");
  });

  it("tolerates stray whitespace and empty tokens", () => {
    expect(toDisplayStage("  Not   Started  ")).toBe("Not Started");
    expect(toDisplayStage("Not Started, ,")).toBe("Not Started");
  });

  it("returns null for blank and non-string input", () => {
    expect(toDisplayStage(null)).toBeNull();
    expect(toDisplayStage(undefined)).toBeNull();
    expect(toDisplayStage("")).toBeNull();
    expect(toDisplayStage("   ")).toBeNull();
    expect(toDisplayStage(",,,")).toBeNull();
    expect(toDisplayStage(42 as unknown as string)).toBeNull();
  });
});

describe("resolveStage", () => {
  it("normalizes case and whitespace", () => {
    expect(resolveStage("NOT STARTED")).toBe("not_started");
    expect(resolveStage("  completed  ")).toBe("complete");
    expect(resolveStage("In Progress")).toBeNull();
  });
});

describe("stageRank", () => {
  it("orders stages per STAGES so the monotonic guard is unaffected", () => {
    expect(stageRank("not_started")).toBe(0);
    expect(stageRank("complete")).toBe(6);
    expect(stageRank(null)).toBe(-1);
  });

  it("labels every canonical stage", () => {
    expect(Object.keys(STAGE_LABELS)).toHaveLength(7);
  });
});