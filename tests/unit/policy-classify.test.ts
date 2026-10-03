import { describe, expect, it } from "vitest";
import { classifyPolicy } from "@/lib/policy/classify";
import { policyAnswered, policyEmptyAnswer, policyRefusal } from "../fixtures";

/**
 * T041 — the answer classifier.
 *
 * THE EMPTY-ANSWER TRAP: the live policy workflow returns HTTP 200 with
 * `status: "success"` and an EMPTY `answer` string. A naive client renders
 * either a blank card or a skeleton that never resolves and reads as "still
 * loading". The BFF must coerce this to `unanswered` before it leaves the
 * server (FR-002, FR-003, SC-003).
 */
describe("classifyPolicy", () => {
  it("classifies a sourced answer as answered", () => {
    const result = classifyPolicy(policyAnswered);
    expect(result.status).toBe("answered");
    expect(result.answer).toContain("15 days");
    expect(result.source).toBe("hr_document.md");
  });

  it("classifies an empty answer on a successful response as unanswered", () => {
    // The dangerous shape, observed live.
    const result = classifyPolicy(policyEmptyAnswer);
    expect(result.status).toBe("unanswered");
    // Coerced to null so no consumer can render an empty string as an answer.
    expect(result.answer).toBeNull();
  });

  it("treats a whitespace-only answer as unanswered", () => {
    const result = classifyPolicy({ ...policyAnswered, answer: "   \n  " });
    expect(result.status).toBe("unanswered");
  });

  it("classifies the workflow's own refusal as unanswered", () => {
    const result = classifyPolicy(policyRefusal);
    expect(result.status).toBe("unanswered");
    // Verbatim, so the employee sees actual source behaviour rather than a
    // UI-rewritten claim.
    expect(result.answer).toContain("does not provide enough information");
  });

  it("requires a source: an answer without one is never 'answered'", () => {
    // FR-002: no answer is presented without a supporting source.
    const result = classifyPolicy({ ...policyAnswered, source: "" });
    expect(result.status).toBe("unanswered");
  });

  it("requires a source: an undefined source is never 'answered'", () => {
    const result = classifyPolicy({ ...policyAnswered, source: undefined });
    expect(result.status).toBe("unanswered");
  });

  it("never returns status 'success' to the browser", () => {
    // The upstream vocabulary must not leak past the BFF boundary.
    for (const payload of [policyAnswered, policyEmptyAnswer, policyRefusal]) {
      expect(["answered", "unanswered", "error"]).toContain(classifyPolicy(payload).status);
    }
  });

  it("maps a malformed body to error", () => {
    expect(classifyPolicy(null).status).toBe("error");
    expect(classifyPolicy({}).status).toBe("error");
  });

  it("preserves the source filename when the answer is refused", () => {
    // Provenance is still known even for a refusal.
    const result = classifyPolicy(policyRefusal);
    expect(result.source).toBe("hr_document.md");
  });
});