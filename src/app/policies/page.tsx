"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card } from "@/components/ui";
import { AnswerCard, UnansweredCard } from "@/components/policies/AnswerCard";
import { DataState } from "@/components/data-state/DataState";
import type { PolicyResponse } from "@/types/domain";

const SUGGESTED = [
  "How much annual leave do I accrue?",
  "How do I enroll in benefits?",
  "What is the remote work policy?",
  "What equipment do I get?",
];

async function searchPolicy(question: string): Promise<PolicyResponse> {
  const response = await fetch(`/api/policies/search?q=${encodeURIComponent(question)}`);
  if (response.status === 400 || response.status === 502) {
    return { status: "error", answer: null, source: null };
  }
  if (!response.ok) {
    return { status: "error", answer: null, source: null };
  }
  const body = (await response.json()) as PolicyResponse;
  return body;
}

/**
 * Policy hub (T047).
 *
 * SEARCH-ONLY. Probes confirmed the upstream workflow accepts only `question`
 * and returns 400 for `category`, `topic`, `query`, `search`, and `action`, so
 * no category filters are offered — presenting filters that cannot work is
 * worse than offering none.
 */
export default function PolicySearch() {
  const [question, setQuestion] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["policy", submitted],
    queryFn: () => searchPolicy(submitted as string),
    enabled: submitted !== null && submitted.length > 0,
    // Policy answers are not polled: a policy does not change every 30 seconds,
    // and re-asking the workflow on a timer would be pure waste.
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="eyebrow text-text-tertiary">Knowledge</span>
        <h1 className="text-h1">Policy &amp; Benefits</h1>
        <p className="text-sm text-text-secondary">
          Every answer is attributed to the document it came from. If no policy covers your question,
          you will be told so plainly.
        </p>
      </header>

      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = question.trim();
            if (trimmed.length > 0) setSubmitted(trimmed);
          }}
        >
          <label htmlFor="policy-question" className="text-caption text-text-secondary font-medium">
            Your question
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="policy-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="e.g. How much annual leave do I accrue?"
              aria-invalid={query.isError || undefined}
              className="min-h-11 flex-1 rounded-md bg-surface-input border border-border-strong px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:ring-2 focus:ring-accent-glow"
            />
            <Button type="submit" variant="primary" busy={query.isFetching} disabled={question.trim().length === 0}>
              Ask
            </Button>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQuestion(s);
                setSubmitted(s);
              }}
              className="min-h-11 rounded-full border border-border-subtle px-3 text-caption text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </Card>

      {submitted !== null && (
        <DataState
          state={query.isPending ? "loading" : "success"}
          label="policy answer"
          hasContent={true}
          skeleton={<div className="h-32 w-full rounded-md bg-surface-raised animate-pulse" />}
        >
          {query.isError ? (
            <UnansweredCard answer={null} source={null} error />
          ) : query.data ? (
            <AnswerCard result={query.data} />
          ) : null}
        </DataState>
      )}
    </div>
  );
}