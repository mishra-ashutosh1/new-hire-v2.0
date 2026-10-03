import { describe, expect, it } from "vitest";
import { classifyPolicy } from "@/lib/policy/classify";
import type { PolicyResponse } from "@/types/domain";
import { policyAnswered, policyEmptyAnswer, policyRefusal } from "../fixtures";

/**
 * T043 — the coercion invariant.
 *
 * This test is written to FAIL if the coercion is ever removed, because that
 * regression reintroduces the single most dangerous response shape in the
 * system: HTTP 200 with `status: "success"` and an empty answer.
 */
describe("policy response coercion invariant", () => {
  const OBSERVED_UPSTREAM_BODIES = [
    { name: "answered", body: policyAnswered },
    { name: "empty-answer", body: policyEmptyAnswer },
    { name: "refusal", body: policyRefusal },
  ];

  it("NEVER emits the upstream success vocabulary", () => {
    for (const { name, body } of OBSERVED_UPSTREAM_BODIES) {
      const result = classifyPolicy(body) as PolicyResponse;
      expect(
        ["answered", "unanswered", "error"],
        `${name} must not leak an unrecognized status`,
      ).toContain(result.status);
      expect(result.status, `${name} must not emit "success"`).not.toBe("success");
    }
  });

  it("NEVER emits a success paired with an empty answer", () => {
    // The exact invariant the contract promises: a browser can never observe
    // `{ status: <ok>, answer: "" }`.
    for (const { name, body } of OBSERVED_UPSTREAM_BODIES) {
      const result = classifyPolicy(body) as PolicyResponse;
      if (result.status === "answered" || result.status === "unanswered") {
        expect(
          result.answer === null || result.answer.trim().length > 0,
          `${name} produced an empty answer string`,
        ).toBe(true);
      }
    }
  });

  it("NEVER emits an answered status without a source", () => {
    for (const { name, body } of OBSERVED_UPSTREAM_BODIES) {
      const result = classifyPolicy(body) as PolicyResponse;
      if (result.status === "answered") {
        expect(result.source, `${name} answered without provenance`).toBeTruthy();
      }
    }
  });

  it("converts the empty-answer payload specifically to unanswered", () => {
    const result = classifyPolicy(policyEmptyAnswer);
    expect(result.status).toBe("unanswered");
    expect(result.answer).toBeNull();
    // Provenance is still known and retained.
    expect(result.source).toBe("hr_document.md");
  });

  it("keeps a genuinely answered response intact", () => {
    const result = classifyPolicy(policyAnswered);
    expect(result.status).toBe("answered");
    expect(result.answer).toBeTruthy();
    expect(result.source).toBe("hr_document.md");
  });
});