import { describe, expect, it } from "vitest";
import { classifyProgress, classifyWelcome } from "@/lib/n8n/classify";
import { progressError, progressNotFound, progressSuccess, welcomeAlreadySent } from "../fixtures";

/**
 * T028 — the three-state trap.
 *
 * onboarding-progress returns `success`, `not_found`, AND `error` all as HTTP
 * 200. If these collapse into one case, HR is told to retry a lookup that can
 * never succeed, and a genuine ops mismatch (sheet row exists, workflow record
 * does not) is hidden as "empty progress".
 */
describe("classifyProgress", () => {
  it("maps a successful payload to the success variant", () => {
    const result = classifyProgress("1201", progressSuccess);
    expect(result.state).toBe("success");
    if (result.state !== "success") throw new Error("expected success");
    expect(result.data.totalItems).toBe(4);
    expect(result.data.outstanding).toHaveLength(4);
    expect(result.data.canUpdateStage).toBe(true);
  });

  it("keeps not_found distinct from error despite both being HTTP 200", () => {
    const notFound = classifyProgress("zzz", progressNotFound);
    const errored = classifyProgress("zzz", progressError);

    expect(notFound.state).toBe("not_found");
    expect(errored.state).toBe("error");

    // The whole point: these must never render the same way.
    expect(notFound.state).not.toBe(errored.state);
    if (notFound.state === "success" || errored.state === "success") {
      throw new Error("expected non-success variants");
    }
    expect(notFound.message).toContain("No onboarding record");
    expect(errored.message).toContain("temp_emp_id is required");
  });

  it("normalizes a missing id in a success payload to the requested id", () => {
    const result = classifyProgress("1201", {
      status: "success",
      percent_complete: 50,
      total_items: 2,
      completed: ["a"],
      outstanding: ["b"],
    });
    expect(result.state).toBe("success");
    if (result.state !== "success") throw new Error("expected success");
    expect(result.data.tempEmpId).toBe("1201");
  });

  it("maps an unparseable body to error rather than throwing", () => {
    const result = classifyProgress("1201", { unexpected: true });
    expect(result.state).toBe("error");
  });

  it("preserves an empty onboarding_stage as null rather than an invalid stage", () => {
    // The live payload has onboarding_stage: "" — an empty string is not a stage.
    const result = classifyProgress("1201", progressSuccess);
    if (result.state !== "success") throw new Error("expected success");
    expect(result.data.stage).toBeNull();
  });

  it("recognizes a valid stage value", () => {
    const result = classifyProgress("1201", {
      ...progressSuccess,
      onboarding_stage: "it_setup",
    });
    if (result.state !== "success") throw new Error("expected success");
    expect(result.data.stage).toBe("it_setup");
  });
});

describe("classifyWelcome", () => {
  it("treats already_sent as success, not error", () => {
    // Idempotent success is the EXPECTED steady state.
    const result = classifyWelcome(welcomeAlreadySent);
    expect(result.status).toBe("already_sent");
    expect(result.status).not.toBe("error");
  });

  it("marks emailSent false on already_sent meaning no new send occurred", () => {
    // Explicitly NOT "the send failed".
    const result = classifyWelcome(welcomeAlreadySent);
    expect(result.emailSent).toBe(false);
  });

  it("preserves the server message verbatim", () => {
    const result = classifyWelcome(welcomeAlreadySent);
    expect(result.message).toBe("Welcome email has already been sent for this employee.");
  });

  it("maps a genuine send to sent with emailSent true", () => {
    const result = classifyWelcome({
      status: "sent",
      email_sent: true,
      message: "Welcome email sent.",
    });
    expect(result.status).toBe("sent");
    expect(result.emailSent).toBe(true);
  });

  it("maps an unparseable body to error", () => {
    expect(classifyWelcome({}).status).toBe("error");
  });
});