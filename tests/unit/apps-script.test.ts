import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Apps Script cannot be executed locally, so the pure logic is verified here by
 * loading the real .gs source with the Google globals stubbed out.
 *
 * This reads the ACTUAL shipped file rather than a copy, so the mapping cannot
 * drift away from the deployed script. The highest-risk logic is the
 * stage mapping: seven app stages collapse into three sheet values, and an
 * error there would write the wrong thing into a real employee's record.
 */

const SOURCE = readFileSync("scripts/apps-script/onboarding-webhook.gs", "utf8");

// Minimal stand-ins for the Apps Script globals. The audit test replaces the
// SpreadsheetApp stub with one whose mutating methods throw.
const STUBS = `
var SpreadsheetApp = {
  getActiveSpreadsheet: function () { return null; },
  getActive: function () { return null; }
};
var Logger = { log: function () {} };
var PropertiesService = { getScriptProperties: function () { return { getProperty: function () { return null; } }; } };
var LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
// TextOutput deliberately exposes ONLY the real Apps Script surface:
// setContentType, setMimeType and getAs. It has NO setStatusCode - Apps Script
// web apps always answer HTTP 200. Previously the stub invented setStatusCode,
// which let a call that throws in production pass 129 tests.
var ContentService = {
  createTextOutput: function (text) {
    return {
      payload: text,
      mime: null,
      setContentType: function () { return this; },
      setMimeType: function (m) { this.mime = m; return this; },
      getAs: function () { return this; }
    };
  },
  MimeType: { JSON: 'json' }
};
`;

const factory = new Function(
  `${STUBS}\n${SOURCE}\nreturn {
  canonicalStage: canonicalStage_,
  statusFor: statusFor_,
  validate: validate_,
  safeEquals: safeEquals_,
  headerMap: headerMap_,
  columnIndex: columnIndex_,
  STAGE_TO_SHEET: STAGE_TO_SHEET,
  SHEET_TO_STAGE: SHEET_TO_STAGE,
  STAGE_RANK: STAGE_RANK,
  ALLOWED_STAGES: ALLOWED_STAGES,
  READ_ONLY_COLUMNS: CONFIG.READ_ONLY_COLUMNS,
  WRITABLE_COLUMNS: CONFIG.WRITABLE_COLUMNS,
  STATUS_COLUMN: CONFIG.STATUS_COLUMN,
  setUp: setUp,
  doGet: doGet,
  json_: json_,
  SpreadsheetApp: SpreadsheetApp,
};`);

const script = factory() as {
  canonicalStage(v: unknown): string | null;
  statusFor(v: unknown): string;
  validate(p: Record<string, unknown>): { error?: string; detail?: string; temp_emp_id?: string; updates?: Record<string, unknown> };
  safeEquals(a: string, b: string): boolean;
  headerMap(sheet: unknown): Record<string, number>;
  columnIndex(map: Record<string, number>, name: string): number;
  STAGE_TO_SHEET: Record<string, string>;
  SHEET_TO_STAGE: Record<string, string>;
  STAGE_RANK: Record<string, number>;
  ALLOWED_STAGES: string[];
  READ_ONLY_COLUMNS: string[];
  WRITABLE_COLUMNS: string[];
  STATUS_COLUMN: string;
  setUp(): void;
  doGet(e: unknown): { payload: string; mime: string | null };
  json_(obj: Record<string, unknown>, code?: number): { payload: string; mime: string | null };
  SpreadsheetApp: {
    getActiveSpreadsheet(): unknown;
    getActive(): unknown;
  };
};

// Apps Script object keys are plain strings, so these lookups are always
// `string | undefined` to TypeScript. Asserted, because an undefined bucket
// would mean a stage silently resolved to nothing.
function rank(stage: string): number {
  const value = script.STAGE_RANK[stage];
  if (value === undefined) throw new Error(`no rank for stage bucket "${stage}"`);
  return value;
}

describe("Apps Script stage mapping (three sheet values, seven app stages)", () => {
  it("collapses every fine app stage into exactly one sheet bucket", () => {
    // All seven app stages must resolve — a stage that falls through would
    // write "null" into the sheet.
    const fine = Object.keys(script.STAGE_TO_SHEET);
    expect(fine).toHaveLength(7);
    for (const stage of fine) {
      const bucket = script.STAGE_TO_SHEET[stage];
      expect(bucket, `"${stage}" has no sheet value`).toBeDefined();
      expect(script.ALLOWED_STAGES).toContain(bucket);
    }
  });

  it("maps each of the seven app stages correctly", () => {
    expect(script.canonicalStage("not_started")).toBe("Not Started");
    expect(script.canonicalStage("it_setup")).toBe("In Progress");
    expect(script.canonicalStage("orientation")).toBe("In Progress");
    expect(script.canonicalStage("meet_and_greet")).toBe("In Progress");
    expect(script.canonicalStage("task_complete")).toBe("In Progress");
    expect(script.canonicalStage("status_confirmed")).toBe("In Progress");
    expect(script.canonicalStage("complete")).toBe("Completed");
  });

  it("accepts the three canonical sheet values in any casing or spacing", () => {
    expect(script.canonicalStage("Not Started")).toBe("Not Started");
    expect(script.canonicalStage("in progress")).toBe("In Progress");
    expect(script.canonicalStage("IN_PROGRESS")).toBe("In Progress");
    expect(script.canonicalStage("  completed  ")).toBe("Completed");
  });

  it("rejects anything outside the allowlist", () => {
    // The whole point of the allowlist: an unrecognised value must be refused,
    // not guessed at.
    expect(script.canonicalStage("Pending")).toBeNull();
    expect(script.canonicalStage("done")).toBeNull();
    expect(script.canonicalStage("")).toBeNull();
    expect(script.canonicalStage(null)).toBeNull();
    expect(script.canonicalStage(undefined)).toBeNull();
    expect(script.canonicalStage(42)).toBeNull();
    expect(script.canonicalStage({})).toBeNull();
  });

  it("resolves the reverse map conservatively, not optimistically", () => {
    // "In Progress" must resolve to the EARLIEST in-progress stage. Mapping it
    // to status_confirmed would require storing the last known stage — a second
    // source of truth.
    expect(script.SHEET_TO_STAGE["in progress"]).toBe("it_setup");
    expect(script.STAGE_TO_SHEET["it_setup"]).toBe("In Progress");
  });

  it("orders the buckets monotonically", () => {
    expect(rank("not started")).toBeLessThan(rank("in progress"));
    expect(rank("in progress")).toBeLessThan(rank("completed"));
  });
});

describe("completion status", () => {
  it("reports 100% only for Completed", () => {
    expect(script.statusFor("Completed")).toBe("100% onboarding completed");
  });

  it("never reports completion for the other states", () => {
    expect(script.statusFor("In Progress")).not.toContain("100%");
    expect(script.statusFor("Not Started")).not.toContain("100%");
    expect(script.statusFor(null)).toBe("");
  });
});

describe("read-only column list", () => {
  it("is fully populated at load time", () => {
    // Regression: READ_ONLY_COLUMNS referenced CONFIG.STAGE_COLUMN from INSIDE
    // the CONFIG object literal, which evaluates against an undefined CONFIG.
    // The whole list silently became [undefined, ...] and the read-only guard
    // stopped guarding anything.
    expect(script.READ_ONLY_COLUMNS).toContain("temp_emp_id");
    expect(script.READ_ONLY_COLUMNS).toContain("welcome_status");
    expect(script.READ_ONLY_COLUMNS).toContain("completed_essentials");
    expect(script.READ_ONLY_COLUMNS).toContain("onboarding_progress_status");
    expect(script.READ_ONLY_COLUMNS).toContain("last_synced_at");
    expect(script.READ_ONLY_COLUMNS.every((c) => typeof c === "string")).toBe(true);
  });

  it("never lists a writable column as read-only", () => {
    for (const column of script.WRITABLE_COLUMNS) {
      expect(
        script.READ_ONLY_COLUMNS,
        `"${column}" is both writable and read-only, so it could never be written`,
      ).not.toContain(column);
    }
  });

  it("names the derived status column, distinct from welcome_status", () => {
    // The two must not collide: welcome_status is welcome-email state and is
    // the user's own column, not one this script owns.
    expect(script.STATUS_COLUMN).toBe("onboarding_progress_status");
    expect(script.STATUS_COLUMN).not.toBe("welcome_status");
  });
});

describe("setUp() is strictly read-only", () => {
  /*
   * The Welcome, Admin and Onboarding Progress workflows all work against the
   * current sheet structure. setUp() was originally a provisioning step that
   * appended two columns; that is exactly the kind of surprise that breaks a
   * working integration, so it was removed.
   *
   * This test makes every mutating SpreadsheetApp method THROW. If setUp() ever
   * grows a write again, this fails immediately rather than after someone has
   * run it against the live sheet.
   */

  const HEADERS = [
    "temp_emp_id", "name", "role", "start_date", "cohort",
    "emailID", "total_essentials", "completed_essentials",
    "onboarding_stage", "welcome_status",
  ];

  const ROWS = [
    ["1201", "Ashish Kumar", "Developer - Lead", "2026-09-30", "3", "a@b.com", 3, "", "", "welcome_sent"],
    ["1202", "Test User", "QA", "2026-10-01", "4", "t@b.com", 3, "", "", "welcome_sent"],
  ];

  function rangeFor(headerRow: boolean) {
    return {
      getValues: () => (headerRow ? [HEADERS] : ROWS),
      getDataSource: () => null,
      setValue: () => {
        throw new Error("MUTATION: setValue called during a read-only audit");
      },
      setValues: () => {
        throw new Error("MUTATION: setValues called during a read-only audit");
      },
    };
  }

  function fakeSheet() {
    return {
      getLastColumn: () => HEADERS.length,
      getLastRow: () => ROWS.length + 1,
      getRange: (_row: number, _col: number, _numRows?: number, _numCols?: number) =>
        rangeFor(_row === 1),
      // Every mutator throws.
      insertColumnAfter: () => {
        throw new Error("MUTATION: insertColumnAfter called during a read-only audit");
      },
      insertColumnsAfter: () => {
        throw new Error("MUTATION: insertColumnsAfter called during a read-only audit");
      },
      deleteColumn: () => {
        throw new Error("MUTATION: deleteColumn called during a read-only audit");
      },
      appendRow: () => {
        throw new Error("MUTATION: appendRow called during a read-only audit");
      },
      clearContent: () => {
        throw new Error("MUTATION: clearContent called during a read-only audit");
      },
      setFrozenRows: () => {
        throw new Error("MUTATION: setFrozenRows called during a read-only audit");
      },
    };
  }

  /** Installs a fake active spreadsheet for the duration of `fn`. */
  async function withFakeSheet<T>(fn: () => T): Promise<T> {
    const original = script.SpreadsheetApp.getActiveSpreadsheet;
    script.SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: () => fakeSheet(),
    });
    try {
      return fn();
    } finally {
      script.SpreadsheetApp.getActiveSpreadsheet = original;
    }
  }

  it("performs no writes", async () => {
    // Any mutation inside setUp() throws from the fake sheet and fails here.
    await expect(withFakeSheet(() => script.setUp())).resolves.toBeUndefined();
  });

  it("performs no writes even with no data rows", async () => {
    const original = script.SpreadsheetApp.getActiveSpreadsheet;
    script.SpreadsheetApp.getActiveSpreadsheet = () => ({
      getSheetByName: () => ({
        ...fakeSheet(),
        getLastRow: () => 1,
      }),
    });
    try {
      script.setUp();
    } finally {
      script.SpreadsheetApp.getActiveSpreadsheet = original;
    }
  });
});

describe("payload validation", () => {
  it("requires temp_emp_id and names the columns it accepts when absent", () => {
    const result = script.validate({ name: "Probe" });
    expect(result.error).toMatch(/temp_emp_id/);
  });

  it("accepts the documented aliases", () => {
    expect(script.validate({ temp_emp_id: "1201", onboarding_stage: "Completed" }).temp_emp_id).toBe("1201");
    expect(script.validate({ tempEmpId: "1201", onboarding_stage: "Completed" }).temp_emp_id).toBe("1201");
    expect(script.validate({ emp_id: "1201", onboarding_stage: "Completed" }).temp_emp_id).toBe("1201");
  });

  it("keeps the id as a string so long ids and leading zeros survive", () => {
    // Coercing to Number would silently corrupt a long id.
    expect(script.validate({ temp_emp_id: 1201000000000009, onboarding_stage: "Completed" }).temp_emp_id).toBe(
      "1201000000000009",
    );
    expect(script.validate({ temp_emp_id: "007", onboarding_stage: "Completed" }).temp_emp_id).toBe("007");
  });

  it("rejects an invalid stage with the allowed list in the detail", () => {
    const result = script.validate({ temp_emp_id: "1201", onboarding_stage: "Pending" });
    expect(result.error).toMatch(/onboarding_stage/);
    expect(result.detail).toContain("Not Started");
  });

  it("rejects a malformed email rather than writing it", () => {
    expect(script.validate({ temp_emp_id: "1201", emailID: "not-an-email" }).error).toMatch(/emailID/);
    expect(script.validate({ temp_emp_id: "1201", emailID: "a@b.com" }).updates?.emailID).toBe("a@b.com");
  });

  it("rejects a non-integer total_essentials", () => {
    expect(script.validate({ temp_emp_id: "1201", total_essentials: -1 }).error).toMatch(/total_essentials/);
    expect(script.validate({ temp_emp_id: "1201", total_essentials: 1.5 }).error).toMatch(/total_essentials/);
    expect(script.validate({ temp_emp_id: "1201", total_essentials: 3 }).updates?.total_essentials).toBe(3);
  });

  it("treats a blank optional field as 'leave alone', not as an empty write", () => {
    // An empty email in a webhook must not blank a real address already there.
    expect(script.validate({ temp_emp_id: "1201", emailID: "" }).updates).toBeUndefined();
  });

  it("rejects the WHOLE payload when one field is invalid", () => {
    // The regression this guards: a `return` inside a forEach callback only
    // exits the callback, so an invalid field was silently DROPPED while the
    // valid fields still wrote. The result was a partial update with no error
    // reported — the sheet and the webhook quietly disagreed.
    const result = script.validate({
      temp_emp_id: "1201",
      onboarding_stage: "Completed",
      emailID: "not-an-email",
    });
    expect(result.error).toMatch(/emailID/);
    // Critically: nothing is applied.
    expect(result.updates).toBeUndefined();
  });

  it("rejects a payload with an invalid number alongside a valid field", () => {
    const result = script.validate({
      temp_emp_id: "1201",
      onboarding_stage: "Completed",
      total_essentials: "three",
    });
    expect(result.error).toMatch(/total_essentials/);
    expect(result.updates).toBeUndefined();
  });

  it("refuses a payload with nothing writable", () => {
    expect(script.validate({ temp_emp_id: "1201" }).error).toMatch(/No writable fields/);
  });

  it("ignores a client-supplied derived status column", () => {
    // The status cell is derived from the stage on the row; a client must not
    // be able to assert "100% onboarding completed" directly.
    const result = script.validate({
      temp_emp_id: "1201",
      onboarding_stage: "In Progress",
      onboarding_progress_status: "100% onboarding completed",
    });
    expect(result.error).toMatch(/read-only/);
  });

  it("refuses a write to welcome_status", () => {
    // welcome_status holds welcome-email state. Letting a webhook write it
    // would let onboarding progress overwrite the welcome audit trail.
    const result = script.validate({
      temp_emp_id: "1201",
      onboarding_stage: "Completed",
      welcome_status: "welcome_sent",
    });
    expect(result.error).toMatch(/read-only/);
    expect(result.error).toMatch(/welcome_status/);
  });

  it("refuses a write to last_synced_at", () => {
    const result = script.validate({
      temp_emp_id: "1201",
      onboarding_stage: "Completed",
      last_synced_at: "1999-01-01T00:00:00Z",
    });
    expect(result.error).toMatch(/read-only/);
  });

  it("still allows onboarding_stage itself, which is not read-only", () => {
    // Guard against the read-only list accidentally including the one column
    // the whole webhook exists to write.
    const result = script.validate({ temp_emp_id: "1201", onboarding_stage: "Completed" });
    expect(result.error).toBeUndefined();
    expect(result.updates?.onboarding_stage).toBe("Completed");
  });
});

describe("header resolution", () => {
  const map = script.headerMap({
    getLastColumn: () => 10,
    getRange: () => ({
      getValues: () => [
        [
          "temp_emp_id", "Name", "Role", "Start Date", "Cohort",
          "emailID", "Total Essentials", "Completed Essentials",
          "Onboarding Stage", "Welcome Status",
        ],
      ],
    }),
  });

  it("resolves columns by header, case and separator insensitively", () => {
    expect(script.columnIndex(map, "temp_emp_id")).toBe(1);
    expect(script.columnIndex(map, "emailID")).toBe(6);
    expect(script.columnIndex(map, "onboarding_stage")).toBe(9);
    expect(script.columnIndex(map, "welcome_status")).toBe(10);
    expect(script.columnIndex(map, "completed_essentials")).toBe(8);
  });

  it("resolves the derived status column once setUp has created it", () => {
    const withDerived = script.headerMap({
      getLastColumn: () => 12,
      getRange: () => ({
        getValues: () => [
          [
            "temp_emp_id", "name", "role", "start_date", "cohort", "emailID",
            "total_essentials", "completed_essentials", "onboarding_stage",
            "welcome_status", "onboarding_progress_status", "last_synced_at",
          ],
        ],
      }),
    });
    expect(script.columnIndex(withDerived, "onboarding_progress_status")).toBe(11);
    expect(script.columnIndex(withDerived, "last_synced_at")).toBe(12);
  });

  it("returns 0 for a column that does not exist", () => {
    // 0 is the sentinel for 'absent', so the writer skips with a warning
    // rather than appending a stray column.
    expect(script.columnIndex(map, "salary")).toBe(0);
    expect(script.columnIndex(map, "onboarding_progress_status")).toBe(0);
  });
});

describe("token comparison", () => {
  it("accepts only an exact match", () => {
    expect(script.safeEquals("secret123", "secret123")).toBe(true);
    expect(script.safeEquals("secret123", "secret124")).toBe(false);
    expect(script.safeEquals("secret", "secret-longer")).toBe(false);
    expect(script.safeEquals("anything", "")).toBe(false);
  });
});

describe("Apps Script API fidelity", () => {
  // Regression guard. Apps Script's ContentService.TextOutput has NO
  // setStatusCode; a stub that invented it let a production TypeError ship.
  // doGet is now driven through the realistic stub, so any call to a method the
  // real API lacks throws here instead of on the deployed web app.
  it("doGet() runs clean against the real TextOutput surface", () => {
    const out = script.doGet({});
    const body = JSON.parse(out.payload);

    expect(body.ok).toBe(true);
    expect(body.service).toBe("onboarding-webhook");
    expect(body.stage_values).toEqual(["Not Started", "In Progress", "Completed"]);
  });

  it("never calls setStatusCode, which does not exist in Apps Script", () => {
    expect(SOURCE).not.toMatch(/setStatusCode/);
  });

  it("carries the intended status in the body as http_status", () => {
    const out = script.json_({ status: "error", code: "UNAUTHENTICATED" }, 401);
    const body = JSON.parse(out.payload);

    expect(body.http_status).toBe(401);
    expect(body.status).toBe("error");
    expect(body.code).toBe("UNAUTHENTICATED");
    expect(out.mime).toBe("json");
  });

  it("omits http_status on success, so 200 stays implicit", () => {
    const out = script.json_({ status: "success" }, 200);

    expect(JSON.parse(out.payload).http_status).toBeUndefined();
  });
});
