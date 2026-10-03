import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NewHireForm } from "@/components/admin/NewHireForm";

/**
 * T061-T064 — provisioning form behaviour.
 *
 * This form is the ONLY way an employee record gets created and it has no dry
 * run, so these tests are about not lying to HR: a duplicate must never be
 * reported as a new hire, a failed submit must never read as success, and the
 * request id must be stable so a retry cannot create a second person.
 *
 * Interactions use `fireEvent` rather than `user-event`, which is not a project
 * dependency. Submission goes through `fireEvent.submit(form)` because jsdom
 * does not implement the implicit submission of a clicked submit button.
 */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function form() {
  return screen.getByTestId("new-hire-form") as HTMLFormElement;
}

function submit() {
  fireEvent.submit(form());
}

/** Fill the required fields and tick the acknowledgement. */
function fillRequired() {
  type(/full name/i, "Priya Nair");
  type(/job title/i, "QA Engineer");
  type(/^email/i, "priya.nair@company.com");
  fireEvent.click(screen.getByTestId("acknowledge"));
}

function renderForm(overrides: Partial<React.ComponentProps<typeof NewHireForm>> = {}) {
  return render(<NewHireForm suggestedId="1303" takenIds={["1201", "1202"]} {...overrides} />);
}

describe("provisioning form", () => {
  it("pre-fills the suggested id so the common case is one Enter key", () => {
    renderForm();
    expect(screen.getByLabelText(/employee id/i)).toHaveValue("1303");
  });

  it("warns when the entered id already exists, before any network call", () => {
    renderForm();
    type(/employee id/i, "1201");
    // The warning appears pre-submit, which is the whole point of it.
    expect(screen.getByTestId("id-collision")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains an absent suggestion rather than leaving an unexplained empty box", () => {
    renderForm({ suggestedId: null, suggestionReason: "The roster could not be read." });
    expect(screen.getByLabelText(/employee id/i)).toHaveValue("");
    expect(screen.getByText(/the roster could not be read/i)).toBeInTheDocument();
  });

  it("blocks submission until the destructive-write warning is acknowledged", () => {
    renderForm();
    type(/full name/i, "Priya Nair");
    type(/job title/i, "QA Engineer");
    type(/^email/i, "priya.nair@company.com");
    submit();
    expect(screen.getByTestId("provision-error")).toHaveTextContent(/welcome email/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports each missing required field instead of posting a doomed request", () => {
    renderForm();
    fireEvent.click(screen.getByTestId("acknowledge"));
    submit();
    expect(screen.getByText(/a name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/a job title is required/i)).toBeInTheDocument();
    expect(screen.getByText(/an email address is required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed email before sending it to the workflow", () => {
    renderForm();
    fillRequired();
    type(/^email/i, "nope");
    submit();
    expect(screen.getByText(/does not look like an email/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the API field names and reuses one request id across retries", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: { message: "upstream down" } }));
    renderForm();
    fillRequired();

    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const calls = fetchMock.mock.calls as unknown as [
      string,
      { body: string; headers: Record<string, string> },
    ][];
    const firstCall = calls.at(0);
    const secondCall = calls.at(1);
    if (!firstCall || !secondCall) throw new Error("expected two submissions");
    const first = firstCall[1];
    const second = secondCall[1];
    // The API speaks `tempEmpId`/`role`/`email`; the workflow's snake_case names
    // are the route's job, not the form's.
    expect(JSON.parse(first.body)).toEqual({
      tempEmpId: "1303",
      name: "Priya Nair",
      role: "QA Engineer",
      email: "priya.nair@company.com",
    });
    // Blank optional fields are OMITTED, never sent as "": an empty string is a
    // value, and a blank field must mean "leave alone", not "clear".
    expect(JSON.parse(first.body)).not.toHaveProperty("startDate");
    // A stable id is what makes a retry safe; a fresh id per click would defeat
    // the server's duplicate guard and create a second employee.
    expect(first.headers["X-Request-Id"]).toBeTruthy();
    expect(second.headers["X-Request-Id"]).toBe(first.headers["X-Request-Id"]);
  });

  it("attaches server-side field errors to the fields they name", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: "VALIDATION_FAILED",
          message: "Correct the highlighted fields and try again.",
          details: [{ field: "email", message: "emailID is already on the roster" }],
        },
      }),
    );
    renderForm();
    fillRequired();
    submit();

    expect(await screen.findByText(/emailID is already on the roster/i)).toBeInTheDocument();
    expect(screen.getByTestId("provision-error")).toHaveTextContent(/highlighted fields/i);
  });

  it("never reports a duplicate as a new hire", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: "1201",
        created: false,
        message: "temp_emp_id 1201 was already processed",
      }),
    );
    renderForm();
    fillRequired();
    submit();

    const result = await screen.findByTestId("provision-result");
    expect(result).toHaveTextContent(/no new record created/i);
    expect(result).toHaveTextContent(/nothing was written/i);
  });

  it("shows the new hire's id and a link to their record on success", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { id: "1303", created: true, message: "New hire record created." }),
    );
    renderForm();
    fillRequired();
    submit();

    const result = await screen.findByTestId("provision-result");
    expect(result).toHaveTextContent(/new hire created/i);
    expect(screen.getByRole("link", { name: /open their record/i })).toHaveAttribute(
      "href",
      "/tracker/1303",
    );
  });

  it("says nothing was created when the server is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    renderForm();
    fillRequired();
    submit();

    // "Safe to retry" is only honest because the request id is stable: a
    // connection dropped after the write may still have created the row, and
    // reusing the id makes the retry a no-op rather than a second employee.
    expect(await screen.findByTestId("provision-error")).toHaveTextContent(/safe to retry/i);
  });

  it("surfaces a disabled-by-flag endpoint instead of a generic failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, {
        error: {
          code: "CONTRACT_UNVERIFIED",
          message: "New-hire provisioning is disabled by flag.",
        },
      }),
    );
    renderForm();
    fillRequired();
    submit();
    expect(await screen.findByTestId("provision-error")).toHaveTextContent(/disabled by flag/i);
  });

  it("names the address that will receive the welcome email before submitting", () => {
    renderForm();
    // The warning quotes whatever address is entered, because that exact address
    // is the thing HR is being asked to confirm.
    expect(screen.getByTestId("provision-warning")).toHaveTextContent(/the address you enter/i);
    type(/^email/i, "priya.nair@company.com");
    expect(screen.getByTestId("provision-warning")).toHaveTextContent("priya.nair@company.com");
  });

  it("disables the submit button while a submission is in flight", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    renderForm();
    fillRequired();
    submit();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /create new hire record/i })).toBeDisabled(),
    );
    release(jsonResponse(201, { id: "1303", created: true, message: "done" }));
    await screen.findByTestId("provision-result");
  });
});

describe("dry run", () => {
  function renderDryRun() {
    return render(<NewHireForm suggestedId="1303" takenIds={["1201", "1202"]} dryRun />);
  }

  it("says up front that submitting will create nothing", () => {
    renderDryRun();
    const warning = screen.getByTestId("provision-warning");
    expect(warning).toHaveTextContent(/nothing will be created/i);
    expect(warning).toHaveTextContent(/receives nothing/i);
    // The live-mode wording would be a lie here.
    expect(warning).not.toHaveTextContent(/real record/i);
  });

  it("labels the action as a preview", () => {
    renderDryRun();
    expect(screen.getByRole("button", { name: /preview without creating/i })).toBeInTheDocument();
  });

  it("does not claim a record exists or offer a link to it", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: "1303",
        created: false,
        dryRun: true,
        message: "Dry run: nothing was written and no welcome email was sent.",
        wire: { temp_emp_id: "1303", emailID: "priya.nair@company.com" },
      }),
    );
    renderDryRun();
    fillRequired();
    submit();

    const result = await screen.findByTestId("provision-result");
    expect(result).toHaveTextContent(/dry run/i);
    expect(result).toHaveTextContent(/no roster row was written/i);
    // A link to a record that does not exist is a 404 dressed as a success.
    expect(screen.queryByRole("link", { name: /open their record/i })).not.toBeInTheDocument();
  });

  it("shows the payload that would have been sent", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: "1303",
        created: false,
        dryRun: true,
        message: "Dry run.",
        wire: { temp_emp_id: "1303", emailID: "priya.nair@company.com" },
      }),
    );
    renderDryRun();
    fillRequired();
    submit();

    const wire = await screen.findByTestId("dry-run-wire");
    expect(JSON.parse(wire.textContent ?? "{}")).toEqual({
      temp_emp_id: "1303",
      emailID: "priya.nair@company.com",
    });
  });

  it("still requires the acknowledgement before previewing", () => {
    renderDryRun();
    type(/full name/i, "Priya Nair");
    type(/job title/i, "QA Engineer");
    type(/^email/i, "priya.nair@company.com");
    submit();
    expect(screen.getByTestId("provision-error")).toHaveTextContent(/preview/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});