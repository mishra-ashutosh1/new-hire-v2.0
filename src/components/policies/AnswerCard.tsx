"use client";

import { Card, StatusBadge } from "@/components/ui";
import type { PolicyResponse } from "@/types/domain";

/**
 * Policy answer cards (T045, T046, T048).
 *
 * The three treatments must be visually DISTINCT, because they call for
 * different responses from the reader:
 *   answered   → "here is the policy, here is where it came from"
 *   unanswered → "nobody has written this down; here is a human to ask"
 *   error      → "the request failed; retry"
 *
 * `unanswered` uses the `--unknown` hue rather than neutral or danger,
 * because "we genuinely don't know" is categorically different from both
 * "something broke" and "not started yet" (FR-003, SC-003).
 */

/**
 * Source attribution (T048).
 *
 * `source` is a FILENAME (`hr_document.md`), not a URL. It is rendered as plain
 * provenance text and deliberately NOT hyperlinked — a link to a bare filename
 * would be broken, and deep-linking requires a filename → canonical URL
 * registry that does not exist yet.
 */
export function SourceAttribution({ source }: { source: string }) {
  return (
    <p data-testid="policy-source" className="flex items-center gap-2 text-caption">
      <span className="eyebrow text-text-tertiary">Source</span>
      <span className="mono text-text-secondary">{source}</span>
    </p>
  );
}

export function AnswerCard({ result }: { result: PolicyResponse }) {
  if (result.status !== "answered") {
    return (
      <UnansweredCard
        answer={result.answer}
        source={result.source}
        error={result.status === "error"}
      />
    );
  }

  return (
    <Card data-testid="answer-card">
      <div className="flex flex-col gap-4">
        <StatusBadge tone="success" label="From company policy" />
        <p className="text-body text-text-primary">{result.answer}</p>
        {result.source && <SourceAttribution source={result.source} />}
      </div>
    </Card>
  );
}

/**
 * Unanswered card (T046).
 *
 * Explicitly states that no policy covers the question and routes to People
 * Operations. When the upstream supplied a refusal, that wording is rendered
 * VERBATIM so the employee sees the actual source behaviour rather than a
 * UI-rewritten claim.
 *
 * When `error` is true this is a transport failure and says so instead —
 * collapsing a failure into "no policy covers this" would send people to
 * consult HR about a temporary outage.
 */
export function UnansweredCard({
  answer,
  source,
  error = false,
}: {
  answer: string | null;
  source: string | null;
  error?: boolean;
}) {
  return (
    <Card data-testid={error ? "policy-error-card" : "unanswered-card"}>
      <div className="flex flex-col gap-4">
        <StatusBadge tone={error ? "danger" : "unknown"} label={error ? "Request failed" : "No policy covers this"} />

        {error ? (
          <p className="text-body text-text-secondary">
            The policy service could not be reached. This is a temporary problem — try again, or
            contact People Operations if it persists.
          </p>
        ) : (
          <>
            <p className="text-body text-text-primary">
              We could not find a documented policy covering this question.
            </p>
            {answer && (
              <blockquote className="border-l-2 border-status-unknown/40 pl-3 text-sm text-text-secondary italic">
                {answer}
              </blockquote>
            )}
            <p className="text-sm text-text-secondary">
              Contact <strong className="text-text-primary">People Operations</strong> to have this
              answered and documented.
            </p>
          </>
        )}

        {source && <SourceAttribution source={source} />}
      </div>
    </Card>
  );
}