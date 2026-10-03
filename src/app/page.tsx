"use client";

import { useQuery } from "@tanstack/react-query";
import { DataState } from "@/components/data-state/DataState";
import { Card, ProgressRing, StatusBadge } from "@/components/ui";
import { QuarantineNotice, TrackerStateBadge } from "@/components/tracker/StatusBadge";
import { fetchJson } from "@/lib/api/fetcher";
import type { Freshness, HealthReport, OnboardingProgress } from "@/types/domain";

/**
 * Executive dashboard (T073).
 *
 * Composed entirely from tracker data — it introduces no new backend calls
 * beyond the health probe, because a dashboard that fetched its own copy of
 * everything would drift from the tracker.
 *
 * The ATTENTION QUEUE is the panel an HR lead actually lives in, so it gets the
 * prominent slot: the expensive onboarding failure is silent — a hire stalls on
 * IT provisioning, never complains, and quietly underperforms for weeks.
 */

interface TrackerRowLite {
  id: string;
  state: "success" | "not_found" | "error";
  message?: string;
  data?: OnboardingProgress;
  employee: { id: string; name: string; role: string | null; cohort: string | null };
}

async function fetchTracker(): Promise<{
  rows: TrackerRowLite[];
  progressFanoutEnabled: boolean;
  rosterFreshness: Freshness;
  quarantined: { count: number };
}> {
  return fetchJson<{
    rows: TrackerRowLite[];
    progressFanoutEnabled: boolean;
    rosterFreshness: Freshness;
    quarantined: { count: number };
  }>("/api/tracker");
}

async function fetchHealth(): Promise<HealthReport> {
  const response = await fetch("/api/health");
  return response.json() as Promise<HealthReport>;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "warning" | "danger" }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="eyebrow text-text-tertiary">{label}</span>
      <span
        className={`text-display font-semibold ${
          tone === "danger"
            ? "text-status-danger"
            : tone === "warning"
              ? "text-status-warning"
              : "text-text-primary"
        }`}
      >
        {value}
      </span>
    </Card>
  );
}

export default function Dashboard() {
  const tracker = useQuery({ queryKey: ["tracker"], queryFn: fetchTracker, refetchInterval: 30_000 });
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth, refetchInterval: 60_000 });

  const rows = tracker.data?.rows ?? [];
  const successes = rows.filter((r) => r.state === "success" && r.data);
  const avgProgress =
    successes.length > 0
      ? Math.round(
          successes.reduce((sum, r) => sum + (r.data?.percentComplete ?? 0), 0) / successes.length,
        )
      : 0;
  // Anything not finished with at least one item outstanding.
  const stalled = successes.filter((r) => (r.data?.outstanding.length ?? 0) > 0);
  const mismatches = rows.filter((r) => r.state === "not_found");

  const cohortCounts = new Map<string, number>();
  for (const row of rows) {
    const cohort = row.employee.cohort ?? "Unassigned";
    cohortCounts.set(cohort, (cohortCounts.get(cohort) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="eyebrow text-text-tertiary">People Operations</span>
        <h1 className="text-h1">Onboarding Overview</h1>
      </header>

      {/*
        Without this, disabling the fan-out renders as a confident "0% average
        completion" and "0 items outstanding" — indistinguishable from a real
        onboarding crisis, and the numbers are actively misleading.
      */}
      {tracker.data && !tracker.data.progressFanoutEnabled && (
        <Card>
          <div className="flex flex-col gap-2">
            <StatusBadge tone="warning" label="Onboarding progress unavailable" />
            <p className="text-sm text-text-secondary">
              Per-employee progress is switched off because the upstream{" "}
              <code className="mono">onboarding-progress</code> workflow writes an empty string to the
              roster&apos;s <code className="mono">onboarding_stage</code> column on every read, which
              would erase the data it reports. Roster data below is read directly from the sheet and is
              accurate; only the progress figures are missing.
            </p>
          </div>
        </Card>
      )}

      {tracker.data && tracker.data.quarantined.count > 0 && (
        <QuarantineNotice count={tracker.data.quarantined.count} />
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Active new hires" value={String(rows.length)} />
        <Kpi label="Average completion" value={`${avgProgress}%`} />
        <Kpi
          label="Items outstanding"
          value={String(successes.reduce((n, r) => n + (r.data?.outstanding.length ?? 0), 0))}
          tone="warning"
        />
        <Kpi label="Record mismatches" value={String(mismatches.length)} tone={mismatches.length > 0 ? "danger" : undefined} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-h3">Attention queue</h2>
              <StatusBadge tone={stalled.length > 0 ? "warning" : "success"} label={`${stalled.length} with outstanding items`} />
            </div>

            <DataState
              state={tracker.isPending ? "loading" : tracker.isError ? "error" : "success"}
              label="attention queue"
              errorMessage={tracker.error instanceof Error ? tracker.error.message : undefined}
              onRetry={() => void tracker.refetch()}
              hasContent={rows.length > 0}
              skeleton={<div className="h-32 w-full rounded-md bg-surface-raised animate-pulse" />}
            >
              {stalled.length === 0 && mismatches.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  Every new hire is fully provisioned. Nothing needs attention.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {mismatches.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-warning/30 px-3 py-2"
                    >
                      <span className="text-sm text-text-primary">{row.employee.name}</span>
                      <TrackerStateBadge state="not_found" />
                    </li>
                  ))}
                  {stalled.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2"
                    >
                      <span className="text-sm text-text-primary">
                        {row.employee.name}
                        <span className="ml-2 text-caption text-text-tertiary">
                          {`${row.data?.outstanding.length} outstanding`}
                        </span>
                      </span>
                      <TrackerStateBadge state="success" />
                    </li>
                  ))}
                </ul>
              )}
            </DataState>
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <div className="flex flex-col gap-4">
              <h2 className="text-h3">Cohort distribution</h2>
              {cohortCounts.size === 0 ? (
                <p className="text-sm text-text-secondary">No cohort data available.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {[...cohortCounts.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([cohort, count]) => {
                      const max = Math.max(...cohortCounts.values());
                      return (
                        <li key={cohort} className="flex flex-col gap-1">
                          <div className="flex justify-between text-caption">
                            <span className="mono text-text-secondary">{cohort}</span>
                            <span className="text-text-tertiary">{count}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-surface-overlay">
                            <div
                              className="h-full rounded-full bg-accent-500"
                              style={{ width: `${(count / max) * 100}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          </Card>

          {/* System health is always visible: broken ingestion must suppress
              confident answering rather than be hidden on an admin page. */}
          <Card>
            <div className="flex flex-col gap-3">
              <h2 className="text-h3">System health</h2>
              <ul className="flex flex-col gap-2 text-sm">
                <li className="flex items-center justify-between gap-3">
                  <span className="text-text-secondary">Automation workflows</span>
                  {/*
                    Three distinct states, not two. Previously a failed health
                    request left `health.data` undefined and rendered
                    "Checking" indefinitely, which reads as "still working on
                    it" rather than "this is broken" — the exact confusion that
                    makes an outage look like a slow start.
                  */}
                  {health.isError ? (
                    <StatusBadge tone="danger" label="Unreachable" />
                  ) : health.data ? (
                    <StatusBadge
                      tone={health.data.n8n.reachable ? "success" : "danger"}
                      label={health.data.n8n.reachable ? "Reachable" : "Unreachable"}
                    />
                  ) : (
                    <StatusBadge tone="neutral" label="Checking" />
                  )}
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-text-secondary">Roster sheet</span>
                  {health.isError ? (
                    <StatusBadge tone="danger" label="Disconnected" />
                  ) : health.data ? (
                    <StatusBadge
                      tone={health.data.sheet.reachable ? "success" : "danger"}
                      label={health.data.sheet.reachable ? "Connected" : "Disconnected"}
                    />
                  ) : (
                    <StatusBadge tone="neutral" label="Checking" />
                  )}
                </li>
                {/* Surface the CAUSE, not just the boolean. */}
                {health.data && !health.data.n8n.reachable && health.data.n8n.detail && (
                  <li className="text-caption text-status-danger">{health.data.n8n.detail}</li>
                )}
                {tracker.data && (
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-text-secondary">Data age</span>
                    <span className="text-caption text-text-tertiary">
                      {tracker.data.rosterFreshness.ageSeconds === null
                        ? "not yet cached"
                        : `${tracker.data.rosterFreshness.ageSeconds}s (${tracker.data.rosterFreshness.source})`}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <div className="flex flex-col items-center gap-3">
          <ProgressRing percent={avgProgress} label="Average onboarding completion" />
          <p className="text-caption text-text-secondary">
            Average completion across {successes.length} of {rows.length} employees with an onboarding
            record.
          </p>
        </div>
      </Card>
    </div>
  );
}