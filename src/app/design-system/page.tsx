"use client";

import { Button, Card, StatusBadge, ProgressBar, ProgressRing, Skeleton } from "@/components/ui";
import { TextInput, SelectInput, Field } from "@/components/ui/Input";
import { DataState } from "@/components/data-state/DataState";
import { TrackerStateBadge, QuarantineNotice, FreshnessIndicator } from "@/components/tracker/StatusBadge";
import { AnswerCard, UnansweredCard } from "@/components/policies/AnswerCard";
import { stageOrder, STAGES } from "@/types/domain";

/**
 * Design system reference (T074).
 *
 * Every component in every state, on one route. Cheaper than Storybook and it
 * tests the same invariants — the DataState blank-panel guard and the five
 * required states are all visible here.
 *
 * State coverage is the point. A component that has only ever been rendered in
 * its happy state is a component whose empty and error states do not exist yet.
 */
export default function DesignSystemPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <span className="eyebrow text-text-tertiary">Reference</span>
        <h1 className="text-h1">Design System</h1>
      </header>

      <Card>
        <h2 className="text-h3 mb-4">Buttons</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" busy>
            Busy
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-h3 mb-4">Status badges</h2>
        <p className="text-caption text-text-tertiary mb-3">
          Every badge pairs a hue with a text label — colour is never the sole carrier of meaning.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone="success" label="Success" />
          <StatusBadge tone="warning" label="Warning" />
          <StatusBadge tone="danger" label="Danger" />
          <StatusBadge tone="info" label="Info" />
          <StatusBadge tone="neutral" label="Neutral" />
          <StatusBadge tone="unknown" label="Unknown" />
        </div>
      </Card>

      <Card>
        <h2 className="text-h3 mb-4">Progress</h2>
        <div className="flex flex-wrap items-center gap-8">
          <ProgressRing percent={64} label="Example completion" />
          <div className="flex min-w-[200px] flex-col gap-2">
            <ProgressBar percent={0} label="Example zero" />
            <ProgressBar percent={42} label="Example partial" />
            <ProgressBar percent={100} label="Example complete" />
            {/* Out-of-range input must clamp, not overflow. */}
            <ProgressBar percent={180} label="Example out of range" />
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-h3 mb-4">Inputs</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default" htmlFor="ds-default">
            <TextInput id="ds-default" placeholder="Placeholder" />
          </Field>
          <Field label="With hint" htmlFor="ds-hint" hint="Helper text below the field.">
            <TextInput id="ds-hint" defaultValue="Value" />
          </Field>
          <Field label="Invalid" htmlFor="ds-error" error="This field has a problem.">
            <TextInput id="ds-error" invalid defaultValue="Bad value" />
          </Field>
          <Field label="Select" htmlFor="ds-select">
            <SelectInput id="ds-select" defaultValue={STAGES[1]}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
      </Card>

      {/* All five DataState treatments, as FR-019 requires. */}
      <Card>
        <h2 className="text-h3 mb-4">Data states (all five required)</h2>
        <div className="grid gap-4">
          <div>
            <span className="eyebrow text-text-tertiary">idle</span>
            <DataState state="idle" label="example" />
          </div>
          <div>
            <span className="eyebrow text-text-tertiary">loading</span>
            <DataState state="loading" label="example" skeleton={<Skeleton className="h-16 w-full" />} />
          </div>
          <div>
            <span className="eyebrow text-text-tertiary">empty</span>
            <DataState state="empty" label="example" emptyMessage="Nothing to show yet." />
          </div>
          <div>
            <span className="eyebrow text-text-tertiary">error</span>
            <DataState
              state="error"
              label="example"
              errorMessage="Something failed."
              onRetry={() => undefined}
            />
          </div>
          <div>
            <span className="eyebrow text-text-tertiary">success</span>
            <DataState state="success" label="example" hasContent>
              <p className="text-sm text-text-primary">Rendered content.</p>
            </DataState>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-h3 mb-4">Tracker row states</h2>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <TrackerStateBadge state="success" />
            <TrackerStateBadge state="not_found" />
            <TrackerStateBadge state="error" />
          </div>
          <QuarantineNotice count={2} />
          <div className="flex items-center gap-4">
            <FreshnessIndicator ageSeconds={12} source="cache" />
            <FreshnessIndicator ageSeconds={340} source="stale" />
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-h3 mb-4">Policy answers</h2>
        <div className="grid gap-4">
          <AnswerCard
            result={{
              status: "answered",
              answer: "Employees accrue 15 days of paid leave per calendar year.",
              source: "hr_document.md",
            }}
          />
          <UnansweredCard answer={null} source="hr_document.md" />
          <UnansweredCard
            answer="The policy does not provide enough information to answer this question. Please contact People Operations."
            source="hr_document.md"
          />
          <UnansweredCard answer={null} source={null} error />
        </div>
      </Card>

      <Card>
        <h2 className="text-h3 mb-4">Stage ordering (monotonic guard basis)</h2>
        <ol className="flex flex-col gap-1">
          {STAGES.map((stage, index) => (
            <li key={stage} className="flex items-center gap-3 text-sm">
              <span className="mono text-caption text-text-tertiary">{index}</span>
              <span className="text-text-primary">{stage.replace(/_/g, " ")}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-caption text-text-tertiary">
          {`A transition must strictly advance: order(${STAGES[6]}) = ${stageOrder("complete")}.`}
        </p>
      </Card>
    </div>
  );
}