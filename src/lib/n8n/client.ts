import { classifyUpstreamError } from "./classify";
import { DEMO_MODE } from "@/lib/demo";
import { demoEmployee, demoKnownIds } from "@/lib/demo/roster";

/**
 * n8n webhook client (T012).
 *
 * All four webhooks are POST-ONLY — a GET returns 404, which is n8n's default
 * for an unregistered method, NOT an outage. This client never issues a GET and
 * never surfaces a 404 as an endpoint failure.
 *
 * Retry policy (FR-022): ONE retry with jitter on 5xx and 429 only. Never
 * retry 4xx and never retry a body-level `status: "error"` — those fail
 * identically on a second attempt, and retrying just delays the message the
 * user needs to see.
 *
 * The base URL and any credentials stay server-side. Nothing here may be
 * imported by a client component.
 */

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 10_000;

export interface WebhookResult {
  ok: boolean;
  httpStatus: number;
  body: unknown;
}

function baseUrl(): string {
  const url = process.env.N8N_BASE_URL;
  if (!url) throw new Error("N8N_BASE_URL is not configured");
  return url.replace(/\/+$/, "");
}

function jitter(ms: number): number {
  return Math.round(ms * (0.5 + Math.random() * 0.5));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST a JSON body to an n8n webhook path. Retries once on retryable status.
 */
/**
 * Canned responses for demo mode (T067).
 *
 * Shapes are copied from the payloads observed live on 2026-10-02, including the
 * unfriendly ones: `onboarding-progress` returns `not_found` as HTTP 200, and an
 * employee with no `onboarding_stage` gets `checklist_source: "none"` with empty
 * `completed` AND `outstanding` — which the UI must render as missing data rather
 * than "all done". A demo that fed tidy optimistic data would demo a UI that
 * does not exist.
 */
function demoWebhookResponse(path: string, body: unknown): WebhookResult {
  const payload = (body ?? {}) as Record<string, unknown>;
  const ok = (inner: unknown): WebhookResult => ({ ok: true, httpStatus: 200, body: inner });

  if (path === "onboarding-progress") {
    const id = String(payload.temp_emp_id ?? "");
    const employee = demoEmployee(id);
    if (!employee) {
      // `not_found` is HTTP 200 in the real workflow, not 404.
      return ok({ status: "not_found", message: `No onboarding record found for ${id}.` });
    }
    const stage = employee.onboarding_stage ?? "";
    const hasChecklist = stage.trim().length > 0;
    return ok({
      status: "success",
      temp_emp_id: id,
      name: employee.name ?? null,
      role: employee.role ?? null,
      onboarding_stage: stage,
      onboarding_status: null,
      welcome_status: employee.welcome_status ?? null,
      percent_complete: hasChecklist ? 33 : 0,
      completed_count: 0,
      total_items: 3,
      completed: [],
      outstanding: hasChecklist ? [stage] : [],
      checklist_source: hasChecklist ? "onboarding_stage" : "none",
      can_update_stage: true,
      requested_stage_update: false,
      message: `Onboarding progress retrieved for ${id}.`,
    });
  }

  if (path === "welcome") {
    // `already_sent` is idempotent success, and `email_sent: false` because no
    // demo ever sends an email.
    return ok({
      status: "already_sent",
      message: "No welcome email was sent: this is demo mode.",
      email_sent: false,
    });
  }

  if (path === "policy") {
    return ok({
      status: "success",
      answer:
        "This is a demo answer generated locally. No policy document was read and no workflow was called.",
      source: "demo",
    });
  }

  if (path === "admin") {
    const id = String(payload.temp_emp_id ?? "");
    if (demoKnownIds().has(id)) {
      return ok({
        status: "already_processed",
        temp_emp_id: id,
        message: `${id} already exists in the demo roster. Nothing was written.`,
      });
    }
    return ok({
      status: "ok",
      temp_emp_id: id,
      name: payload.name ?? null,
      emailID: payload.emailID ?? null,
      // The real workflow reports an onboarding STATUS here. It is omitted rather
      // than invented, because a demo must not manufacture onboarding progress.
      message: "Demo hire accepted. No email was sent and no sheet was written.",
    });
  }

  return { ok: false, httpStatus: 404, body: { message: `demo mode has no webhook "${path}"` } };
}

export async function callWebhook(
  path: string,
  body: unknown,
  options: { timeoutMs?: number } = {},
): Promise<WebhookResult> {
  // Demo mode returns BEFORE `baseUrl()` is read, so no URL is ever constructed
  // and no socket is opened. A missing N8N_BASE_URL cannot turn a demo into an
  // accidental live call.
  if (DEMO_MODE) return demoWebhookResponse(path, body);

  const url = `${baseUrl()}/webhook/${path}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let attempt = 0;
  // At most 2 attempts total: the original plus one retry.
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });

      if (RETRYABLE.has(response.status) && attempt === 0) {
        attempt += 1;
        await sleep(jitter(250));
        continue;
      }

      // A 4xx body is often empty; do not let JSON parsing throw over it.
      let parsed: unknown = null;
      try {
        const text = await response.text();
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }

      return { ok: response.ok, httpStatus: response.status, body: parsed };
    } catch (cause) {
      // Network/abort failure: retry once, then surface as a failed result.
      if (attempt === 0) {
        attempt += 1;
        await sleep(jitter(250));
        continue;
      }
      return {
        ok: false,
        httpStatus: 0,
        body: { message: cause instanceof Error ? cause.message : "upstream unreachable" },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/* --- Typed wrappers --------------------------------------------------- */

export async function fetchProgress(tempEmpId: string): Promise<WebhookResult> {
  return callWebhook("onboarding-progress", { temp_emp_id: tempEmpId });
}

export async function updateProgressStage(
  tempEmpId: string,
  stage: string,
): Promise<WebhookResult> {
  return callWebhook("onboarding-progress", { temp_emp_id: tempEmpId, stage });
}

export async function sendWelcome(tempEmpId: string): Promise<WebhookResult> {
  return callWebhook("welcome", { temp_emp_id: tempEmpId });
}

export async function askPolicy(question: string): Promise<WebhookResult> {
  return callWebhook("policy", { question });
}

export async function createNewHire(payload: unknown): Promise<WebhookResult> {
  return callWebhook("admin", payload);
}

export { classifyUpstreamError };

/**
 * Run `worker` over `items` with bounded concurrency. A full read of the sheet
 * is a single request regardless of row count, but the fan-out across N
 * employees is N webhook calls, so concurrency is capped.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index] as T, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
}