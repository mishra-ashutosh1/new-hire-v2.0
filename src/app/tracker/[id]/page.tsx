"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataState } from "@/components/data-state/DataState";
import { fetchJson } from "@/lib/api/fetcher";
import { Button, Card, SelectInput } from "@/components/ui";
import { Field } from "@/components/ui/Input";
import { ItemCountDiscrepancy, OutstandingList, ProgressHero } from "@/components/tracker/Progress";
import { FreshnessIndicator, TrackerStateBadge } from "@/components/tracker/StatusBadge";
import { STAGES, type OnboardingProgress, type RowResult, type Stage } from "@/types/domain";

interface DetailPayload {
  employee: {
    id: string;
    name: string;
    role: string | null;
    startDate: string | null;
    cohort: string | null;
    email: string | null;
    totalEssentials: number | null;
    /**
     * The sheet's own stage chip, plus the welcome-email state.
     *
     * Both were missing from this type even though the route has always returned
     * them, which is how the Stage line came to be sourced from `progress.stage`
     * instead and rendered an invented "Not started". A hand-maintained client
     * type that drifts from the route silently costs you the ability to use a
     * field you already have.
     */
    stage: string | null;
    stageStatus: string | null;
  };
  progress: RowResult;
  freshness: { fetchedAt: string; ageSeconds: number; source: "live" | "cache" | "stale" };
}

async function fetchDetail(id: string): Promise<DetailPayload> {
  return fetchJson<DetailPayload>(`/api/tracker/${encodeURIComponent(id)}`);
}

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const employeeId = Array.isArray(id) ? id[0] : (id ?? "");
  const router = useRouter();

  const [selectedStage, setSelectedStage] = useState<Stage>("it_setup");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const query = useQuery({
    queryKey: ["tracker", employeeId],
    queryFn: () => fetchDetail(employeeId),
    enabled: employeeId.length > 0,
  });

  async function advanceStage() {
    setSubmitting(true);
    setUpdateError(null);
    try {
      const response = await fetch(`/api/tracker/${encodeURIComponent(employeeId)}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: selectedStage }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setUpdateError(body.error?.message ?? `update failed with HTTP ${response.status}`);
        return;
      }
      // Refetch so the view shows authoritative state, never an optimistic guess.
      await query.refetch();
    } catch (cause) {
      setUpdateError(cause instanceof Error ? cause.message : "update failed");
    } finally {
      setSubmitting(false);
    }
  }

  const progress = query.data?.progress;
  const successData = progress?.state === "success" ? progress.data : null;

  const state = query.isPending ? "loading" : query.isError ? "error" : "success";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => router.push("/tracker")}
            className="eyebrow text-text-tertiary hover:text-text-secondary min-h-11 text-left"
          >
            ← Tracker
          </button>
          <h1 className="text-h1">{query.data?.employee.name ?? "Employee"}</h1>
        </div>
        {query.data && (
          <FreshnessIndicator
            ageSeconds={query.data.freshness.ageSeconds}
            source={query.data.freshness.source}
          />
        )}
      </header>

      <Card>
        <DataState
          state={state}
          label="employee onboarding"
          errorMessage={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          hasContent={progress !== undefined}
          skeleton={<div className="h-40 w-full rounded-md bg-surface-raised animate-pulse" />}
        >
          {progress && (
            <div className="flex flex-col gap-6">
              {progress.state !== "success" ? (
                // not_found and error render distinctly — see TrackerStateBadge.
                <div className="flex flex-col items-start gap-3">
                  <TrackerStateBadge state={progress.state} />
                  <p className="text-sm text-text-secondary">{progress.message}</p>
                  {progress.state === "not_found" && (
                    <p className="text-caption text-text-tertiary">
                      This employee exists in the roster sheet but has no onboarding record in the
                      workflow. Retrying will not help — this is a data consistency issue for HR to
                      reconcile.
                    </p>
                  )}
                  {progress.state === "error" && (
                    <Button size="sm" onClick={() => void query.refetch()}>
                      Retry
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-6">
                    <ProgressHero progress={successData as OnboardingProgress} />
                    <div className="flex flex-col gap-2 text-sm">
                      <p className="text-text-secondary">
                        {`Role: ${query.data?.employee.role ?? "Not recorded"}`}
                      </p>
                      <p className="text-text-secondary">
                        {`Start date: ${query.data?.employee.startDate ?? "Not recorded"}`}
                      </p>
                      <p className="text-text-secondary">
                        {`Cohort: ${query.data?.employee.cohort ?? "Not recorded"}`}
                      </p>
                      <p className="text-text-secondary">
                        {/*
                         * Reads `employee.stage` — the sheet's own chip label — not
                         * `progress.stage`. Two reasons, both learned the hard way:
                         *
                         * 1. It previously fell back to the literal "Not started" when the
                         *    stage was null, which is an AFFIRMATIVE claim built from an
                         *    absence, sitting directly above the "this is missing data, not
                         *    zero progress" banner. It also contradicted the tracker's own
                         *    Stage column, which correctly shows an em dash for the same
                         *    employee.
                         * 2. `progress.stage` is the webhook's CANONICAL field. The sheet
                         *    holds coarse labels ("Not Started", "In Progress") that share no
                         *    literal value with the canonical enum, so it is null for every
                         *    real row by design (see src/lib/stages.ts). Using it here would
                         *    have shown nothing even when the sheet DID hold a stage.
                         *
                         * Same source and same fallback as Role / Start date / Cohort above.
                         */}
                        {`Stage: ${query.data?.employee.stage ?? "Not recorded"}`}
                      </p>
                    </div>
                  </div>

                  <ItemCountDiscrepancy
                    webhookTotal={(successData as OnboardingProgress).totalItems}
                    sheetTotal={query.data?.employee.totalEssentials ?? null}
                  />

                  <OutstandingList progress={successData as OnboardingProgress} />

                  {/*
                    Stage control gated on can_update_stage. When false the
                    control is disabled AND the reason is shown — a disabled
                    button with no explanation reads as a broken app.
                  */}
                  <section className="flex flex-col gap-3 border-t border-border-subtle pt-6">
                    <h2 className="eyebrow text-text-tertiary">Advance stage</h2>
                    {(successData as OnboardingProgress).canUpdateStage ? (
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="w-full sm:w-64">
                          <Field label="New stage" htmlFor="stage-select">
                            <SelectInput
                              id="stage-select"
                              value={selectedStage}
                              onChange={(e) => setSelectedStage(e.target.value as Stage)}
                            >
                              {STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {s.replace(/_/g, " ")}
                                </option>
                              ))}
                            </SelectInput>
                          </Field>
                        </div>
                        <Button variant="primary" onClick={advanceStage} busy={submitting}>
                          Advance stage
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-text-tertiary">
                        The onboarding workflow does not currently permit a stage update for this
                        employee.
                      </p>
                    )}
                    {updateError && (
                      <p role="alert" className="text-sm text-status-danger">
                        {updateError}
                      </p>
                    )}
                  </section>
                </>
              )}
            </div>
          )}
        </DataState>
      </Card>
    </div>
  );
}