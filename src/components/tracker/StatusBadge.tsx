"use client";

import { StatusBadge, type StatusTone } from "@/components/ui";

/**
 * Tracker status badge (T036).
 *
 * The three row states get DISTINCT visual treatments, because the underlying
 * conditions demand different responses from HR:
 *   success    → show progress
 *   not_found  → the sheet and the workflow disagree; an ops mismatch to fix
 *   error      → a transient failure; retry may well work
 *
 * Collapsing not_found into error would send HR to retry a lookup that can never
 * succeed, and would hide a genuine data-consistency problem behind a spinner.
 */
export type TrackerState = "success" | "not_found" | "error";

const CONFIG: Record<TrackerState, { tone: StatusTone; label: string }> = {
  success: { tone: "success", label: "On track" },
  not_found: {
    tone: "warning",
    // Deliberately not "Error": this is a data mismatch, not a failure.
    label: "Record mismatch",
  },
  error: { tone: "danger", label: "Unavailable" },
};

export function TrackerStateBadge({ state }: { state: TrackerState }) {
  const { tone, label } = CONFIG[state];
  return <StatusBadge tone={tone} label={label} />;
}

/**
 * Welcome-EMAIL state, from the sheet's `welcome_status` column.
 *
 * Deliberately NOT rendered inside the onboarding-stage cell. These are
 * different facts written by different actors: `welcome_status` records whether
 * a welcome email went out, `onboarding_stage` records how far the hire has got.
 * Nesting one under the other is exactly the conflation the sheet mapping
 * comments warn against, and it would make a hire who received their email but
 * has completed nothing look onboarded.
 *
 * Unknown / blank values render as "—" rather than "Not sent": the portal has no
 * way to distinguish "no email sent" from "column never populated".
 */
export function WelcomeBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-caption text-text-tertiary">—</span>;

  const key = status.trim().toLowerCase();
  if (key === "welcome_sent" || key === "sent") {
    return <StatusBadge tone="success" label="Welcome sent" />;
  }
  if (key === "pending_welcome" || key === "pending" || key === "not_sent") {
    return <StatusBadge tone="warning" label="Welcome pending" />;
  }
  // Unrecognised value: show it rather than hiding an upstream surprise.
  return <StatusBadge tone="neutral" label={status} />;
}

/** Quarantined-row notice for staff, never shown as an employee. */
export function QuarantineNotice({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div
      role="status"
      className="rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning"
    >
      {count} roster {count === 1 ? "row is" : "rows are"} malformed or placeholder data and{" "}
      {count === 1 ? "was" : "were"} excluded from this view. The source sheet needs cleanup.
    </div>
  );
}

/**
 * Freshness indicator (T039).
 *
 * Silent refresh is precisely the dishonesty the constitution targets, so the
 * data age is always visible — no figure is presented as live when it is not.
 */
export function FreshnessIndicator({
  ageSeconds,
  source,
}: {
  ageSeconds: number;
  source: "live" | "cache" | "stale";
}) {
  const label = source === "stale" ? "stale — showing last known data" : `updated ${ageSeconds}s ago`;

  return (
    <span
      data-testid="freshness"
      className={`text-caption ${source === "stale" ? "text-status-warning" : "text-text-tertiary"}`}
    >
      {label}
    </span>
  );
}

/**
 * Countdown to the next poll (T039).
 *
 * Refreshing every 30 seconds without saying so would present a static screen
 * as a live one. The countdown makes the refresh cadence explicit.
 */
export function PollCountdown({ seconds }: { seconds: number }) {
  return (
    <span data-testid="poll-countdown" className="text-caption text-text-tertiary">
      {`Refreshes in ${Math.max(0, seconds)}s`}
    </span>
  );
}