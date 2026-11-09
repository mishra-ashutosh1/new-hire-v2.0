import type { HealthReport } from "@/types/domain";
import { ApiError, type BffErrorBody } from "./fetcher";

function isHealthReport(body: unknown): body is HealthReport {
  if (!body || typeof body !== "object") return false;
  const value = body as Partial<HealthReport>;
  return (
    (value.status === "ok" || value.status === "degraded") &&
    typeof value.n8n?.reachable === "boolean" &&
    typeof value.sheet?.reachable === "boolean"
  );
}

/** HTTP 503 may carry a valid degraded report; a 401 error body never does. */
export async function fetchHealth(): Promise<HealthReport> {
  const response = await fetch("/api/health");
  const body: unknown = await response.json();
  if ((response.ok || response.status === 503) && isHealthReport(body)) return body;
  const error = body && typeof body === "object" ? (body as BffErrorBody).error : undefined;
  throw new ApiError(
    error?.message ?? "System health could not be loaded.",
    response.status,
    error?.code ?? "HEALTH_UNAVAILABLE",
  );
}
