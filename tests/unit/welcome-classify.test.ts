import { describe, expect, it } from "vitest";
import { classifyWelcome } from "@/lib/n8n/classify";
import { welcomeAlreadySent } from "../fixtures";

/**
 * T049 — welcome classification.
 *
 * `already_sent` is the NORMAL steady state, not a failure. Rendering it as a
 * warning would make the page permanently alarming and train HR to ignore it.
 */
describe("classifyWelcome", () => {
  it("treats already_sent as a success status", () => {
    const result = classifyWelcome(welcomeAlreadySent);
    expect(result.status).toBe("already_sent");
    expect(result.status).not.toBe("error");
  });

  it("signals that no new send occurred, distinct from failure", () => {
    // emailSent:false here means "nothing was sent because it was already
    // sent" — the opposite meaning from "the send failed".
    const result = classifyWelcome(welcomeAlreadySent);
    expect(result.emailSent).toBe(false);
    expect(result.status).not.toBe("error");
  });

  it("preserves the server message verbatim for display", () => {
    const result = classifyWelcome(welcomeAlreadySent);
    expect(result.message).toBe("Welcome email has already been sent for this employee.");
  });

  it("distinguishes a genuine send", () => {
    const result = classifyWelcome({ status: "sent", email_sent: true, message: "Sent." });
    expect(result.status).toBe("sent");
    expect(result.emailSent).toBe(true);
  });

  it("maps an unrecognizable body to error", () => {
    expect(classifyWelcome({ nothing: true }).status).toBe("error");
    expect(classifyWelcome(null).status).toBe("error");
  });

  it("always returns a displayable message", () => {
    for (const body of [welcomeAlreadySent, { status: "sent" }, {}, null]) {
      const result = classifyWelcome(body);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});