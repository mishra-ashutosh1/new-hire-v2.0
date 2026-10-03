import type { PolicyResponse } from "@/types/domain";

/**
 * Policy answer classification.
 *
 * The upstream workflow returns HTTP 200 with `status: "success"` for BOTH a
 * real answer and an empty one. That makes `status` alone useless for deciding
 * what to render, and it is the single most dangerous response shape in the
 * system: a naive client shows a blank card, or a skeleton that never resolves
 * and reads as "still loading".
 *
 * Classification:
 *   answered   — non-empty answer AND non-empty source (both are required)
 *   unanswered — empty/whitespace answer, or the workflow's own refusal
 *   error      — unreachable, or an unparseable body
 *
 * The upstream vocabulary (`"success"`) never leaves this function.
 */

const REFUSAL_MARKER = "does not provide enough information";

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function classifyPolicy(body: unknown): PolicyResponse {
  if (body === null || typeof body !== "object") {
    return { status: "error", answer: null, source: null };
  }

  const record = body as Record<string, unknown>;
  const answer = asText(record.answer);
  const source = asText(record.source);
  const upstreamStatus = record.status;

  if (upstreamStatus === "error") {
    return { status: "error", answer: null, source };
  }
  if (upstreamStatus !== "success") {
    // An unrecognized body is not something to guess at.
    return { status: "error", answer: null, source };
  }

  // Empty answer on a successful response: the observed trap.
  if (answer === null) {
    return { status: "unanswered", answer: null, source };
  }

  // The workflow's own refusal wording, rendered verbatim by the UI.
  if (answer.toLowerCase().includes(REFUSAL_MARKER)) {
    return { status: "unanswered", answer, source };
  }

  // FR-002: an answer without a supporting source must never be presented.
  if (source === null) {
    return { status: "unanswered", answer: null, source: null };
  }

  return { status: "answered", answer, source };
}