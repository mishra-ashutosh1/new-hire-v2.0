import Link from "next/link";
import { redirect } from "next/navigation";

import { NewHireForm } from "@/components/admin/NewHireForm";
import { Card } from "@/components/ui";
import { canAccessModule, getSession } from "@/lib/auth/session";
import { POC_MODE_ENABLED } from "@/lib/auth/poc";
import { suggestNextTempEmpId } from "@/lib/admin/suggest-id";

/**
 * Provisioning (T061-T066).
 *
 * This page previously had NO WAY to add a hire. `POST /api/admin/new-hire` has
 * been complete and contract-verified since 2026-10-02, but the page rendered a
 * "temporarily unavailable" notice with the flag off and a placeholder with no
 * fields at all with it on — so "Provision New Hire" was a nav item that led
 * nowhere.
 *
 * The form collects exactly what `Validate New Hire1` requires: `temp_emp_id`
 * (caller-assigned — the workflow errors without it), name, role as a JOB TITLE,
 * and emailID, with start_date, cohort, total_essentials and onboarding_stage
 * passed through only when filled in. `completed_essentials` is never sent,
 * because sheet column H is a formula over column I.
 *
 * ORDER MATTERS WHEN AUTH IS ON. The module check runs before the roster read:
 * deriving a suggested id means fetching every employee record, and `session.ts`
 * treats authorization-before-fetch as an access-boundary obligation, not an
 * optimisation. The API route repeats the check — hiding this page is not the
 * control.
 *
 * `NEW_HIRE_POC_MODE=true` skips both, for demos only. See `src/lib/auth/poc.ts`.
 */
export default async function NewHirePage() {
  const session = await getSession();

  if (!POC_MODE_ENABLED) {
    if (!session) redirect("/login");

    if (!canAccessModule(session.role, "new-hire")) {
      return (
        <Card>
          <div className="flex flex-col gap-3">
            <h1 className="text-h3 text-text-primary">Not available to your role</h1>
            <p className="text-sm text-text-secondary">
              Provisioning creates employee records, so it is limited to HR administrators. You
              are signed in as <span className="mono">{session.role}</span>.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/tracker"
                className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 text-sm hover:bg-surface-overlay"
              >
                Go to tracker
              </Link>
            </div>
          </div>
        </Card>
      );
    }
  }

  if (process.env.ADMIN_CONTRACT_VERIFIED !== "true") {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <span className="eyebrow text-text-tertiary">Administration</span>
          <h1 className="text-h1">Provision a New Hire</h1>
        </header>

        <Card>
          <div className="flex flex-col gap-4">
            <h2 className="text-h3 text-text-primary">Provisioning is disabled by flag</h2>
            <p className="text-sm text-text-secondary">
              Set <code className="mono">ADMIN_CONTRACT_VERIFIED=true</code> to enable it. The
              contract was confirmed against the workflow on 2026-10-02 and this form collects
              every field it requires, but the endpoint stays off until it is deliberately switched
              on — it creates real employee records.
            </p>
            <p className="text-sm text-text-secondary">
              Existing onboarding progress, policy answers, and welcome auditing are unaffected and
              remain available.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/tracker"
                className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 text-sm hover:bg-surface-overlay"
              >
                Go to tracker
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // A failed roster read must not block provisioning: the id stays editable and the
  // form explains why there is no suggestion.
  const suggestion = await suggestNextTempEmpId();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="eyebrow text-text-tertiary">Administration</span>
        <h1 className="text-h1">Provision a New Hire</h1>
        <p className="text-sm text-text-secondary">
          Writes one row to the roster sheet and triggers the onboarding workflow.
        </p>
      </header>

      {/* Loud on purpose. An unauthenticated write endpoint must never be
          mistaken for a signed-in one — someone left to find this by accident
          should learn it exists from the page, not from an audit log. */}
      {POC_MODE_ENABLED ? (
        <div
          role="note"
          data-testid="poc-banner"
          className="rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
        >
          <p className="font-medium text-text-primary">POC mode — authentication is bypassed</p>
          <p className="mt-1 text-text-secondary">
            <code className="mono">NEW_HIRE_POC_MODE=true</code>, so this page and its endpoint
            accept requests with no session. Demos only; set it to{" "}
            <code className="mono">false</code> to restore the sign-in requirement.
          </p>
        </div>
      ) : null}

      <NewHireForm
        suggestedId={suggestion.suggested}
        takenIds={suggestion.taken}
        suggestionReason={suggestion.reason}
        dryRun={process.env.NEW_HIRE_DRY_RUN === "true"}
      />
    </div>
  );
}