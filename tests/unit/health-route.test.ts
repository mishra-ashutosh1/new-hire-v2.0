import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const callWebhook = vi.hoisted(() => vi.fn());
const probeSheetReachable = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/n8n/client", () => ({ callWebhook }));
vi.mock("@/lib/sheets/client", () => ({ probeSheetReachable }));
vi.mock("@/lib/sheets/cache", () => ({ rosterAgeSeconds: () => 4 }));

import { GET } from "@/app/api/health/route";

beforeEach(() => {
  getSession.mockReset();
  callWebhook.mockReset().mockResolvedValue({ ok: true, httpStatus: 200, body: {} });
  probeSheetReachable.mockReset().mockResolvedValue(true);
});

describe("GET /api/health", () => {
  it("requires a session before probing n8n or the sheet", async () => {
    getSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(callWebhook).not.toHaveBeenCalled();
    expect(probeSheetReachable).not.toHaveBeenCalled();
  });
  it("probes upstreams for an authenticated user", async () => {
    getSession.mockResolvedValue({ email: "hr@company.com", role: "hr_admin", scopedEmployeeIds: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(callWebhook).toHaveBeenCalledTimes(1);
  });
});
