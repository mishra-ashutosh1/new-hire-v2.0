import { describe, expect, it } from "vitest";
import { serializeEmployee, DISCLOSABLE_FIELDS, containsProhibitedField } from "@/lib/serializer/employee";
import { mapSheetRow } from "@/lib/contracts/schemas";
import { ingestRows } from "@/lib/sheets/ingest";
import { rawRow } from "../fixtures";

/**
 * T077 — the PII allowlist (FR-024, SC-010).
 *
 * This test is written to FAIL if the serializer is ever converted from an
 * allowlist to a denylist. With an allowlist a new sheet column is excluded by
 * default; with a denylist, adding a `salary` column to the sheet silently
 * exposes it to every employee until someone remembers to block it.
 */
describe("PII allowlist", () => {
  it("drops unknown sheet columns at the mapping boundary", () => {
    const mapped = mapSheetRow({
      temp_emp_id: "1201",
      name: "Ashish Kumar",
      // A future column nobody has reviewed:
      salary: "185000",
      health_plan: "Gold PPO",
      government_id: "XXX-XX-1234",
    });

    expect(mapped).not.toHaveProperty("salary");
    expect(mapped).not.toHaveProperty("health_plan");
    expect(mapped).not.toHaveProperty("government_id");
    // Known fields survive.
    expect(mapped.id).toBe("1201");
  });

  it("never leaks a PII column through ingest", () => {
    const result = ingestRows([
      rawRow({
        temp_emp_id: "1201",
        name: "Ashish Kumar",
        salary: "185000",
        compensation: "185000",
      }),
    ]);
    expect(result.employees[0]).not.toHaveProperty("salary");
    expect(result.employees[0]).not.toHaveProperty("compensation");
  });

  it("emits only allowlisted fields", () => {
    const serialized = serializeEmployee({
      id: "1201",
      name: "Ashish Kumar",
      role: "Developer - Lead",
      startDate: "2026-09-30",
      cohort: "3",
      email: "acm5520@gmail.com",
      totalEssentials: 3,
      stage: null,
      stageStatus: "welcome_sent",
      // Extra properties an upstream might attach:
      salary: "185000",
      health: "none",
    } as never);

    expect(Object.keys(serialized).sort()).toEqual([...DISCLOSABLE_FIELDS].sort());
  });

  it("produces a payload with no prohibited field present", () => {
    const serialized = serializeEmployee({
      id: "1201",
      name: "Ashish Kumar",
      role: null,
      startDate: null,
      cohort: null,
      email: null,
      totalEssentials: null,
      stage: null,
      stageStatus: null,
    });

    expect(containsProhibitedField(serialized)).toBe(false);
  });

  it("detects a prohibited field when one is present", () => {
    // Guards the guard: containsProhibitedField must actually work.
    expect(containsProhibitedField({ name: "x", salary: "1" })).toBe(true);
    expect(containsProhibitedField({ name: "x", benefitsElection: "Gold" })).toBe(true);
    expect(containsProhibitedField({ name: "x" })).toBe(false);
  });
});

describe("welcome_status stays out of onboarding state", () => {
  /*
   * Regression. `welcome_status` holds welcome-EMAIL state ("welcome_sent").
   * It was once mapped onto `stageStatus`, so the tracker rendered
   * "welcome_sent" as an onboarding STAGE, and the welcome console read it
   * under the wrong name. These assert the two stay separate fields.
   */

  it("maps welcome_status to welcomeStatus, never to stageStatus", () => {
    const mapped = mapSheetRow({
      temp_emp_id: "1201",
      welcome_status: "welcome_sent",
    });
    expect(mapped).toHaveProperty("welcomeStatus", "welcome_sent");
    expect(mapped).not.toHaveProperty("stageStatus");
  });

  it("keeps the onboarding stage a distinct field", () => {
    const mapped = mapSheetRow({
      temp_emp_id: "1201",
      onboarding_stage: "In Progress",
      welcome_status: "welcome_sent",
    });
    expect(mapped.stage).toBe("In Progress");
    expect(mapped.welcomeStatus).toBe("welcome_sent");
  });

  it("does not invent an onboarding stage from a welcome value", () => {
    const mapped = mapSheetRow({ temp_emp_id: "1201", welcome_status: "welcome_sent" });
    // An absent onboarding_stage must stay absent, not fall back to the
    // welcome value — a hire whose welcome email was sent is NOT onboarded.
    expect(mapped.stage).toBeUndefined();
  });
});