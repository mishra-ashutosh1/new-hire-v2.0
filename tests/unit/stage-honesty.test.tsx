/**
 * A null stage must never render as an affirmative claim.
 *
 * Found live on 2026-10-03: `/tracker/1201` rendered "Stage: Not started" while the
 * tracker's own Stage column showed an em dash for the same employee, and the
 * panel directly above said progress was missing data rather than zero. Three
 * surfaces, three different answers, one of them invented.
 *
 * The em dash choice is deliberate. "Not started" is a plausible inference for a
 * new hire with no recorded stage — which is exactly why it is dangerous. It is
 * indistinguishable from a stage the sheet actually recorded, and this product's
 * constitution requires that inference never be presented as known state. Same
 * rule as `OutstandingList`: an empty value is missing data.
 */
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { buildColumns, type TrackerRow } from "@/components/tracker/EmployeeTable";

function row(stage: string | null): TrackerRow {
  return {
    id: "1201",
    employee: {
      id: "1201",
      name: "Ashish Kumar",
      role: "Developer - Lead",
      startDate: "2026-09-30",
      cohort: "3",
      email: "ashish@company.com",
      totalEssentials: 3,
      stage,
      stageStatus: "welcome_sent",
    },
    state: "success",
    data: null,
  } as unknown as TrackerRow;
}

/** Render the real Stage cell for a row whose sheet stage is `stage`. */
function renderStageCell(stage: string | null) {
  const column = buildColumns().find((c) => c.key === "stage");
  if (!column) throw new Error("Stage column is missing from buildColumns()");
  const cell = column.render(row(stage)) as ReactElement;
  render(
    <table>
      <tbody>
        <tr>
          <td>{cell}</td>
        </tr>
      </tbody>
    </table>,
  );
}

describe("Stage never fabricates a value from an absence", () => {
  it('shows an em dash, never "Not started", when the sheet has no stage', () => {
    renderStageCell(null);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/not started/i);
  });

  it("shows the sheet's own label when one exists", () => {
    renderStageCell("Not Started");
    expect(screen.getByText("Not Started")).toBeInTheDocument();
  });

  it("renders a multi-value chips cell in full rather than truncating it", () => {
    renderStageCell("Not Started, In Progress");
    expect(screen.getByText("Not Started, In Progress")).toBeInTheDocument();
  });

  it("keeps an unrankable coarse label visible instead of blanking it", () => {
    // "In Progress" has no canonical equivalent and is deliberately left
    // unresolved (src/lib/stages.ts). It must still be SHOWN — resolving it to
    // null and rendering an em dash would hide data the sheet does hold.
    renderStageCell("In Progress");
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });
});