/**
 * "No checklist" must never read as "all done".
 *
 * Found live on 2026-10-03: with `onboarding_stage` blank, the
 * onboarding-progress webhook returns `completed: []`, `outstanding: []`,
 * `total_items: 3` and `checklist_source: "none"`. Those two empty lists are
 * indistinguishable from a finished checklist, and the component rendered them
 * as "Nothing outstanding. All items complete." — telling a real new hire they
 * had finished onboarding when nothing was being tracked at all.
 *
 * This is the failure mode the whole product exists to prevent (a panel that
 * looks like an answer but is not one), so it is asserted at both boundaries:
 * the classifier must carry the signal through, and the component must use it.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OutstandingList } from "@/components/tracker/Progress";
import { classifyProgress } from "@/lib/n8n/classify";
import type { OnboardingProgress } from "@/types/domain";
import { progressFromChips, progressNoChecklist, progressSuccess } from "../fixtures";

function renderFor(raw: unknown) {
  const result = classifyProgress("1201", raw);
  if (result.state !== "success") throw new Error("fixture must classify as success");
  render(<OutstandingList progress={result.data} />);
  return result.data;
}

describe("classifier carries checklist_source through", () => {
  it('maps "none" to "none" rather than dropping it', () => {
    const result = classifyProgress("1201", progressNoChecklist);
    expect(result.state).toBe("success");
    if (result.state !== "success") return;
    expect(result.data.checklistSource).toBe("none");
  });

  it('maps "onboarding_stage" to itself', () => {
    const result = classifyProgress("1302", progressFromChips);
    if (result.state !== "success") throw new Error("expected success");
    expect(result.data.checklistSource).toBe("onboarding_stage");
  });

  it("maps an ABSENT checklist_source to null, never to \"none\"", () => {
    // The 2026-10-02 fixture predates the field. Unknown must stay unknown: if a
    // missing field were coerced to "none", every older payload would start
    // claiming that no checklist exists.
    const result = classifyProgress("1201", progressSuccess);
    if (result.state !== "success") throw new Error("expected success");
    expect(result.data.checklistSource).toBeNull();
  });

  it("fails the whole response on an unrecognised checklist_source", () => {
    // The schema is a closed enum, so a drifted upstream value fails validation
    // and the row reports `error` — it does NOT silently reach the UI as a
    // claim. Failing loudly is the intended behaviour: a new `checklist_source`
    // value is a contract change someone must look at, not something to absorb.
    const result = classifyProgress("1201", { ...progressNoChecklist, checklist_source: "sheet_v2" });
    expect(result.state).toBe("error");
  });
});

describe("OutstandingList never presents missing data as completion", () => {
  it('says "missing data, not zero progress" when there is no checklist', () => {
    renderFor(progressNoChecklist);
    expect(screen.getByTestId("no-checklist")).toBeInTheDocument();
    expect(screen.getByText(/missing data, not zero progress/i)).toBeInTheDocument();
  });

  it('never renders "All items complete" for an untracked employee', () => {
    renderFor(progressNoChecklist);
    expect(screen.queryByText(/all items complete/i)).toBeNull();
  });

  it("states the real total so the reader knows data is missing", () => {
    // total_items is 3; naming it stops the panel reading as "nothing to do".
    renderFor(progressNoChecklist);
    expect(screen.getByText(/lists 3 essentials/i)).toBeInTheDocument();
  });

  it("still renders the outstanding list when a checklist does exist", () => {
    renderFor(progressFromChips);
    expect(screen.queryByTestId("no-checklist")).toBeNull();
    expect(screen.getByText("Not Started")).toBeInTheDocument();
    expect(screen.getByText(/Outstanding \(1\)/)).toBeInTheDocument();
  });

  it('says "All items complete" only for a genuine empty-but-present checklist', () => {
    // checklistSource is unknown here, which is NOT the same as "none", so the
    // normal list renders. This pins the boundary of the change: the fix must not
    // swallow the legitimate completed state.
    const progress: OnboardingProgress = {
      tempEmpId: "1201",
      name: "Ashish Kumar",
      role: "Developer - Lead",
      stage: null,
      stageStatus: null,
      percentComplete: 100,
      completedCount: 3,
      totalItems: 3,
      completed: ["A", "B", "C"],
      outstanding: [],
      checklistSource: "onboarding_stage",
      canUpdateStage: true,
      requestedStageUpdate: false,
    };
    render(<OutstandingList progress={progress} />);
    expect(screen.queryByTestId("no-checklist")).toBeNull();
    expect(screen.getByText(/All items complete/i)).toBeInTheDocument();
  });
});