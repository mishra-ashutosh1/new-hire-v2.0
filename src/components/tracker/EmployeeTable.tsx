"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataState } from "@/components/data-state/DataState";
import { fetchJson } from "@/lib/api/fetcher";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/ResponsiveTable";
import { Button } from "@/components/ui/Button";
import { Card, Skeleton } from "@/components/ui";
import { ProgressBarWithCount } from "@/components/tracker/Progress";
import {
  FreshnessIndicator,
  PollCountdown,
  QuarantineNotice,
  TrackerStateBadge,
  WelcomeBadge,
} from "@/components/tracker/StatusBadge";
import type { Freshness, OnboardingProgress } from "@/types/domain";

const POLL_SECONDS = 30;

export interface TrackerRow {
  id: string;
  state: "success" | "not_found" | "error";
  message?: string;
  data?: OnboardingProgress;
  employee: {
    id: string;
    name: string;
    role: string | null;
    startDate: string | null;
    cohort: string | null;
    email: string | null;
    totalEssentials: number | null;
    stage: string | null;
    stageStatus: string | null;
  };
}

interface TrackerPayload {
  rows: TrackerRow[];
  rosterFreshness: Freshness;
  quarantined: { count: number; rowNumbers: number[] };
}

async function fetchTracker(): Promise<TrackerPayload> {
  // Surfaces the BFF's explanation ("roster unreachable") rather than a bare
  // status code, so the user knows whether to retry or escalate.
  return fetchJson<TrackerPayload>("/api/tracker");
}

/**
 * Column definitions, extracted from the component so they can be asserted
 * directly in tests (tests/unit/stage-honesty.test.tsx).
 *
 * `TrackerView` owns its own react-query fetch, so it cannot be rendered with
 * fixture rows; asserting the cell renderers is the only way to pin behaviour
 * that a user reads as a claim about an employee's actual state.
 */
export function buildColumns(): ResponsiveColumn<TrackerRow>[] {
  return [
    {
      key: "name",
      header: "Employee",
      primary: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-text-primary">{row.employee.name}</span>
          <span className="mono text-caption text-text-tertiary">{row.employee.id}</span>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => row.employee.role ?? "—",
    },
    {
      key: "cohort",
      header: "Cohort",
      render: (row) => row.employee.cohort ?? "—",
    },
    {
      key: "stage",
      header: "Stage",
      // The sheet's own chip label, rendered verbatim — a multi-value cell like
      // "Not Started, In Progress" is shown in full rather than truncated,
      // because truncating it would misrepresent which stages are recorded.
      //
      // Null renders as an em dash, never as an inferred stage. The detail page
      // used to fall back to "Not started" here, which is a plausible-sounding
      // fabrication: it is indistinguishable from a stage the sheet recorded.
      render: (row) => (
        <span className="text-sm text-text-primary">{row.employee.stage ?? "—"}</span>
      ),
    },
    {
      key: "welcome",
      header: "Welcome",
      // Deliberately its own column rather than nested under Stage. `welcome_status`
      // records that an email went out; `onboarding_stage` records how far the hire
      // has progressed. Nesting them would make someone who received their welcome
      // email but completed nothing look onboarded.
      render: (row) => <WelcomeBadge status={row.employee.stageStatus} />,
    },
    {
      key: "progress",
      header: "Progress",
      render: (row) =>
        row.state === "success" && row.data ? (
          <ProgressBarWithCount progress={row.data} />
        ) : (
          <span className="text-caption text-text-tertiary">Not available</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <TrackerStateBadge state={row.state} />,
    },
    {
      key: "detail",
      header: "Detail",
      render: (row) =>
        row.state === "success" ? null : (
          <span className="text-caption text-text-secondary">{row.message}</span>
        ),
    },
  ];
}

export function TrackerView() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(POLL_SECONDS);

  const query = useQuery({
    queryKey: ["tracker"],
    queryFn: fetchTracker,
    refetchInterval: POLL_SECONDS * 1000,
    // Paused while the tab is hidden — polling a hidden tab is wasted work and
    // an unnecessary load on n8n.
    refetchIntervalInBackground: false,
  });

  // Visible countdown, so the refresh is never silent.
  useEffect(() => {
    const timer = setInterval(
      () => setSeconds((s) => (s <= 1 ? POLL_SECONDS : s - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [query.dataUpdatedAt]);

  const rows = query.data?.rows ?? [];
  const columns = buildColumns();

  const state = query.isPending ? "loading" : query.isError ? "error" : "success";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-text-tertiary">Operations</span>
          <h1 className="text-h1">Onboarding Tracker</h1>
        </div>
        <div className="flex items-center gap-4">
          {query.data && (
            <FreshnessIndicator
              ageSeconds={query.data.rosterFreshness.ageSeconds}
              source={query.data.rosterFreshness.source}
            />
          )}
          <PollCountdown seconds={seconds} />
          <Button size="sm" onClick={() => void query.refetch()} busy={query.isFetching}>
            Refresh
          </Button>
        </div>
      </header>

      {query.data && <QuarantineNotice count={query.data.quarantined.count} />}

      <Card>
        <DataState
          state={state}
          label="onboarding progress"
          errorMessage={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          hasContent={rows.length > 0}
          skeleton={
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          }
        >
          <ResponsiveTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/tracker/${encodeURIComponent(row.id)}`)}
            emptyMessage="No employees are currently onboarding."
          />
        </DataState>
      </Card>
    </div>
  );
}