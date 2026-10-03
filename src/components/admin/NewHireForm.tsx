"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, Card, Field, TextInput } from "@/components/ui";

/**
 * New-hire provisioning form (T061-T064).
 *
 * WHY THIS IS THE MISSING PIECE
 * -----------------------------
 * `POST /api/admin/new-hire` has been complete and contract-verified since
 * 2026-10-02, but the page rendered a placeholder with NO FIELDS whenever the flag
 * was on, and a "temporarily unavailable" notice when it was off. There was no way
 * to add a hire from the UI at all.
 *
 * The contract, read from `Validate New Hire1`:
 *   required from the client : temp_emp_id, name, role (a JOB TITLE), emailID
 *   optional, passed through : start_date, cohort, total_essentials, onboarding_stage
 *   never sent              : completed_essentials (sheet column H is a formula)
 *
 * WHAT THIS FORM DOES NOT HIDE
 * ---------------------------
 * With `NEW_HIRE_DRY_RUN=true` a submit validates and reports exactly what it
 * would send, and writes nothing — no roster row, no welcome email. Without it,
 * submitting creates a real row and the onboarding workflow emails the address on
 * the form. The banner says which of the two is in force, before you submit,
 * because an irreversible action that emails a stranger must not be one Enter key
 * away — and a *safe* action must not be dressed up as dangerous either.
 */
export interface NewHireFormProps {
  /** Pre-filled id, from the roster's highest numeric id + 1. Editable. */
  suggestedId: string | null;
  /** Ids already in use, to warn about a collision before submitting. */
  takenIds: string[];
  suggestionReason?: string;
  /** True when `NEW_HIRE_DRY_RUN=true`: submits validate but write nothing. */
  dryRun?: boolean;
}

type FieldErrors = Partial<Record<string, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function NewHireForm({
  suggestedId,
  takenIds,
  suggestionReason,
  dryRun = false,
}: NewHireFormProps) {
  const [tempEmpId, setTempEmpId] = useState(suggestedId ?? "");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [startDate, setStartDate] = useState("");
  const [cohort, setCohort] = useState("");
  const [totalEssentials, setTotalEssentials] = useState("");
  const [onboardingStage, setOnboardingStage] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    id: string;
    created: boolean;
    dryRun: boolean;
    wire: Record<string, unknown> | null;
    message: string;
  } | null>(null);

  /*
   * ONE request id per form instance, generated once.
   *
   * The route refuses a repeat of the same `X-Request-Id`, which is what makes a
   * double-click or an impatient retry safe. It must therefore be STABLE across
   * retries of the SAME submission — regenerating it on every click would defeat
   * the dedup and create two employees.
   */
  const requestId = useMemo(
    () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    [],
  );

  const collision = takenIds.includes(tempEmpId.trim());

  /**
   * Client-side mirror of `adminRequestSchema`.
   *
   * Deliberately NOT a substitute for the server: the schema is the boundary, and
   * this only saves a round trip and gives per-field messages. The submit button
   * stays enabled so a mis-typed field produces a message rather than a dead form.
   */
  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!tempEmpId.trim()) errors.tempEmpId = "An employee id is required.";
    if (!name.trim()) errors.name = "A name is required.";
    if (!role.trim()) errors.role = "A job title is required.";
    if (!email.trim()) errors.email = "An email address is required.";
    else if (!EMAIL_RE.test(email.trim())) errors.email = "That does not look like an email address.";
    if (startDate && !DATE_RE.test(startDate)) errors.startDate = "Use YYYY-MM-DD.";
    if (totalEssentials && !/^\d+$/.test(totalEssentials)) {
      errors.totalEssentials = "A whole number, or leave blank.";
    }
    return errors;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (!acknowledged) {
      setFailure(
        dryRun
          ? "Confirm the details to run the preview."
          : "Confirm that a real record will be created and a welcome email sent.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        tempEmpId: tempEmpId.trim(),
        name: name.trim(),
        role: role.trim(),
        email: email.trim(),
      };
      // Optional keys are OMITTED, never sent as null or "": an empty string is a
      // value, and a blank field must mean "leave alone" rather than "clear".
      if (startDate) payload.startDate = startDate;
      if (cohort.trim()) payload.cohort = cohort.trim();
      if (totalEssentials) payload.totalEssentials = Number(totalEssentials);
      if (onboardingStage.trim()) payload.onboardingStage = onboardingStage.trim();

      const response = await fetch("/api/admin/new-hire", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => null)) as
        | {
            id?: string;
            created?: boolean;
            dryRun?: boolean;
            wire?: Record<string, unknown>;
            message?: string;
            error?: { code?: string; message?: string; details?: unknown };
          }
        | null;

      if (response.status === 201 || response.status === 200) {
        setCreated({
          id: body?.id ?? tempEmpId.trim(),
          created: body?.created !== false && body?.dryRun !== true,
          dryRun: body?.dryRun === true,
          wire: body?.wire ?? null,
          message: body?.message ?? "Record created.",
        });
        return;
      }

      // Field-keyed validation errors from the workflow or the schema.
      const details = body?.error?.details;
      if (response.status === 400 && Array.isArray(details)) {
        const mapped: FieldErrors = {};
        for (const d of details as { field?: string; message?: string }[]) {
          if (d?.field) mapped[d.field] = d.message ?? "Rejected by the workflow.";
        }
        setFieldErrors(mapped);
      }
      setFailure(
        body?.error?.message ??
          `The request failed (HTTP ${response.status}). Nothing was created.`,
      );
    } catch {
      setFailure("Could not reach the server. Nothing was created — safe to retry.");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <div
            role="status"
            data-testid="provision-result"
            className="flex flex-col gap-3 text-sm"
          >
            <h2 className="text-h3 text-text-primary">
              {created.dryRun
                ? "Dry run — nothing was created"
                : created.created
                  ? "New hire created"
                  : "No new record created"}
            </h2>
            <p className="text-text-secondary">{created.message}</p>
            <p className="text-text-secondary">
              Identifier: <span className="mono">{created.id}</span>
            </p>
            {created.dryRun ? (
              <>
                <p className="text-text-secondary">
                  No roster row was written, no audit row was appended, and no welcome email was
                  sent. There is no employee record to open yet.
                </p>
                {created.wire ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-caption text-text-secondary font-medium">
                      Exactly what would have been sent to the workflow
                    </p>
                    <pre
                      data-testid="dry-run-wire"
                      className="mono overflow-x-auto rounded-md border border-border-strong bg-surface-input p-3 text-caption text-text-primary"
                    >
                      {JSON.stringify(created.wire, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </>
            ) : !created.created ? (
              <p className="text-text-secondary">
                That identifier already exists in the sheet, so nothing was written and no
                duplicate welcome email was sent.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              {/* A link to a record is only true when one exists — a dry run and a
                  duplicate must never offer a 404 dressed as a success. */}
              {created.created ? (
                <Link
                  href={`/tracker/${encodeURIComponent(created.id)}`}
                  className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 text-sm hover:bg-surface-overlay"
                >
                  Open their record
                </Link>
              ) : null}
              <Link
                href="/tracker"
                className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 text-sm hover:bg-surface-overlay"
              >
                Back to tracker
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <form onSubmit={submit} data-testid="new-hire-form" className="flex flex-col gap-6">
      <div
        role="note"
        data-testid="provision-warning"
        className={
          dryRun
            ? "rounded-md border border-accent-500/40 bg-accent-500/10 px-4 py-3 text-sm"
            : "rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
        }
      >
        <p className="font-medium text-text-primary">
          {dryRun ? "Dry run — nothing will be created" : "This creates a real record"}
        </p>
        {dryRun ? (
          <p className="mt-1 text-text-secondary">
            Submitting validates these details and shows exactly what would be sent. No roster row
            is written, no audit row is appended, and{" "}
            <strong>{email.trim() || "the address you enter"}</strong> receives nothing.
          </p>
        ) : (
          <p className="mt-1 text-text-secondary">
            Submitting writes a row to the roster sheet and the onboarding workflow sends{" "}
            <strong>{email.trim() || "the address you enter"}</strong> a welcome email. Wrong
            details mean a real person receives a real email.
          </p>
        )}
      </div>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee id" htmlFor="tempEmpId" error={fieldErrors.tempEmpId}>
            <TextInput
              id="tempEmpId"
              name="tempEmpId"
              value={tempEmpId}
              invalid={Boolean(fieldErrors.tempEmpId)}
              onChange={(e) => setTempEmpId(e.target.value)}
              placeholder="1205"
            />
            {collision ? (
              <p className="text-caption text-status-danger" data-testid="id-collision">
                That id is already in the sheet. The workflow will treat this as a duplicate
                and create nothing.
              </p>
            ) : suggestionReason ? (
              <p className="text-caption text-text-tertiary">{suggestionReason}</p>
            ) : (
              <p className="text-caption text-text-tertiary">
                Suggested from the roster. Change it if ids are issued elsewhere.
              </p>
            )}
          </Field>

          <Field label="Full name" htmlFor="name" error={fieldErrors.name}>
            <TextInput
              id="name"
              name="name"
              value={name}
              invalid={Boolean(fieldErrors.name)}
              onChange={(e) => setName(e.target.value)}
              placeholder="Priya Nair"
            />
          </Field>

          <Field label="Job title" htmlFor="role" error={fieldErrors.role}>
            <TextInput
              id="role"
              name="role"
              value={role}
              invalid={Boolean(fieldErrors.role)}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Developer - Lead"
            />
            <p className="text-caption text-text-tertiary">
              Their role at work, e.g. &quot;QA Engineer&quot; — not their portal access.
            </p>
          </Field>

          <Field label="Email" htmlFor="email" error={fieldErrors.email}>
            <TextInput
              id="email"
              name="email"
              type="email"
              value={email}
              invalid={Boolean(fieldErrors.email)}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="priya.nair@company.com"
            />
          </Field>

          <Field label="Start date" htmlFor="startDate" error={fieldErrors.startDate}>
            <TextInput
              id="startDate"
              name="startDate"
              value={startDate}
              invalid={Boolean(fieldErrors.startDate)}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="YYYY-MM-DD"
            />
          </Field>

          <Field label="Cohort" htmlFor="cohort" error={fieldErrors.cohort}>
            <TextInput
              id="cohort"
              name="cohort"
              value={cohort}
              onChange={(e) => setCohort(e.target.value)}
              placeholder="5"
            />
          </Field>

          <Field
            label="Total essentials"
            htmlFor="totalEssentials"
            error={fieldErrors.totalEssentials}
          >
            <TextInput
              id="totalEssentials"
              name="totalEssentials"
              value={totalEssentials}
              invalid={Boolean(fieldErrors.totalEssentials)}
              onChange={(e) => setTotalEssentials(e.target.value)}
              placeholder="3"
              inputMode="numeric"
            />
            <p className="text-caption text-text-tertiary">
              Varies per hire, so it is an attribute rather than a global constant.
            </p>
          </Field>

          <Field label="Onboarding stage" htmlFor="onboardingStage" error={fieldErrors.onboardingStage}>
            <TextInput
              id="onboardingStage"
              name="onboardingStage"
              value={onboardingStage}
              onChange={(e) => setOnboardingStage(e.target.value)}
              placeholder="Day 0"
            />
            <p className="text-caption text-text-tertiary">
              Optional — the workflow defaults to &quot;Day 0&quot; when blank.
            </p>
          </Field>
        </div>

        <label className="mt-6 flex items-start gap-3 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            data-testid="acknowledge"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong"
          />
          <span>
            {dryRun
              ? "I have checked these details, understanding this is a preview and creates nothing."
              : "I have checked the email address, because submitting sends a welcome email to that person."}
          </span>
        </label>

        {failure ? (
          <p role="alert" data-testid="provision-error" className="mt-4 text-sm text-status-danger">
            {failure}
          </p>
        ) : null}

        <div className="mt-6">
          <Button type="submit" variant="primary" busy={submitting}>
            {dryRun ? "Preview without creating" : "Create new hire record"}
          </Button>
        </div>
      </Card>
    </form>
  );
}