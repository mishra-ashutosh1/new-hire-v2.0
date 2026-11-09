import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth } from "@/lib/api/health";

const report = {
  status: "degraded",
  n8n: { reachable: false, checkedAt: "2026-11-09T00:00:00Z", detail: "timeout" },
  sheet: { reachable: true, ageSeconds: 2, checkedAt: "2026-11-09T00:00:00Z" },
};
function reply(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}
afterEach(() => vi.unstubAllGlobals());

describe("dashboard health fetcher", () => {
  it("keeps a degraded HTTP 503 report", async () => {
    reply(503, report);
    expect(await fetchHealth()).toEqual(report);
  });
  it("throws for a 401 body instead of passing it to the dashboard", async () => {
    reply(401, { error: { code: "UNAUTHENTICATED", message: "authentication required" } });
    await expect(fetchHealth()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });
  it("rejects an incomplete health report", async () => {
    reply(200, { status: "ok" });
    await expect(fetchHealth()).rejects.toMatchObject({ code: "HEALTH_UNAVAILABLE" });
  });
});
