import { NextResponse } from "next/server";
import { probeSheetReachable } from "@/lib/sheets/client";
import { rosterAgeSeconds } from "@/lib/sheets/cache";
import { callWebhook } from "@/lib/n8n/client";
import type { HealthReport } from "@/types/domain";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Liveness for both upstreams. Feeds the dashboard's system-health panel —
 * ingestion health is a first-class, always-visible surface rather than a
 * hidden admin page, because the constitution's freshness principle requires
 * broken ingestion to suppress confident answering rather than hide.
 *
 * This probes a real webhook and a real sheet read. It is intentionally
 * cheap: one n8n call and, at worst, one cached sheet read.
 */
export async function GET() {
  const checkedAt = new Date().toISOString();

  // A GET would return 404 on these POST-only webhooks; send a minimal POST
  // and treat the RESPONSE STATUS (not 404-on-GET) as the signal.
  const n8n = await callWebhook("policy", { question: "health check" }).catch((cause: unknown) => ({
    ok: false,
    httpStatus: 0,
    body: null,
    error: cause instanceof Error ? cause.message : String(cause),
  }));

  // Record WHY an upstream is unreachable, not just that it is. A bare
  // `reachable: false` sent an operator to the dashboard with nothing to act
  // on; the constitution's observability principle requires the cause to be
  // visible rather than hidden behind a boolean.
  const n8nDetail =
    n8n.ok || !("error" in n8n)
      ? null
      : String((n8n as { error?: unknown }).error ?? `HTTP ${n8n.httpStatus || "no response"}`);

  const sheetReachable = await probeSheetReachable();
  const age = rosterAgeSeconds();

  const report: HealthReport = {
    status: n8n.ok && sheetReachable ? "ok" : "degraded",
    n8n: { reachable: n8n.ok, checkedAt, ...(n8nDetail ? { detail: n8nDetail } : {}) },
    sheet: {
      reachable: sheetReachable,
      /*
       * `null`, never `-1`. The sentinel used to mean "no roster cached yet",
       * but it leaked into the response as a literal age and the dashboard
       * would render a data age of minus one second. A negative age is not a
       * number of seconds; absence is `null`.
       */
      ageSeconds: age,
      checkedAt,
    },
  };

  return NextResponse.json(report, { status: report.status === "ok" ? 200 : 503 });
}