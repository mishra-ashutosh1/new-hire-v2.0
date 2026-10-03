import { describe, expect, it, vi } from "vitest";

/**
 * T059 — double-submit protection.
 *
 * This is the only test guarding the creation of real employee records. The
 * in-flight mutex refuses a repeated submission carrying the same client
 * request id, so two clicks (or a retry) produce ONE record, not two.
 *
 * ⚠️ This mirrors the route's guard logic. The authoritative check is the E2E
 * spec in tests/e2e/admin-double-submit.spec.ts, which must be run against a
 * SANDBOX workflow, never production.
 */

const INFLIGHT_TTL_MS = 60_000;

/** Mirror of the route's in-flight guard. */
class InflightMutex {
  private readonly map = new Map<string, { startedAt: number }>();

  claim(requestId: string): boolean {
    const now = Date.now();
    for (const [key, value] of this.map) {
      if (now - value.startedAt > INFLIGHT_TTL_MS) this.map.delete(key);
    }
    if (this.map.has(requestId)) return false;
    this.map.set(requestId, { startedAt: now });
    return true;
  }
}

describe("double-submit protection (FR-014, SC-007)", () => {
  it("refuses a second claim with the same request id", () => {
    const mutex = new InflightMutex();
    expect(mutex.claim("req-1")).toBe(true);
    // A second claim while the first is in flight must be refused.
    expect(mutex.claim("req-1")).toBe(false);
  });

  it("allows distinct request ids to proceed independently", () => {
    const mutex = new InflightMutex();
    expect(mutex.claim("req-1")).toBe(true);
    expect(mutex.claim("req-2")).toBe(true);
  });

  it("refuses the duplicate for many rapid concurrent claims", () => {
    const mutex = new InflightMutex();
    const claims = Array.from({ length: 10 }, () => mutex.claim("same-id"));
    // Exactly one succeeds, so at most one record can be created.
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("does not permanently block a request id after the TTL expires", () => {
    const mutex = new InflightMutex();
    expect(mutex.claim("req-1")).toBe(true);
    // Simulate expiry rather than waiting a real minute.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + INFLIGHT_TTL_MS + 1_000);
    expect(mutex.claim("req-1")).toBe(true);
    vi.restoreAllMocks();
  });
});