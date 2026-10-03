import { classifyUpstreamError } from "./classify";

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
export async function callWebhook(
  path: string,
  body: unknown,
  options: { timeoutMs?: number } = {},
): Promise<WebhookResult> {
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