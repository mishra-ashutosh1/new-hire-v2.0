/**
 * Builds the FIXED copy of the `Check Onboarding Progress` n8n workflow.
 *
 * The transformation lives here, in the repo, rather than in a throwaway script,
 * so the change is reviewable and reproducible: anyone can re-run it against a
 * fresh export and diff the result.
 *
 * Usage:
 *   npx tsx scripts/build-fixed-onboarding-workflow.ts <source.json> [outDir]
 *
 * With no arguments it looks for the source in the places n8n exports have been
 * found on this machine, and writes to
 * specs/001-people-ops-portal/workflows/.
 *
 * It NEVER modifies the source file.
 *
 * ---------------------------------------------------------------------------
 * TWO DEFECTS CORRECTED
 * ---------------------------------------------------------------------------
 *
 * 1. DESTRUCTIVE READ (blanked the sheet on 2026-10-02)
 *    `Stage Update Requested?` had `leftValue: ""`, `rightValue: ""`, operator
 *    `equals`. `"" === ""` is TRUE, so the gate passed EVERY request — including
 *    reads carrying no `onboarding_stage`. `Update Onboarding Stage` then wrote
 *    an empty string into the sheet's `onboarding_stage` column (I), and column
 *    H — the formula `=IF(I{r}="","",COUNTA(SPLIT(I{r},",",FALSE,TRUE)))` —
 *    blanked with it.
 *    The gate existed and looked correct. It was wired to nothing.
 *    Fix: `notEmpty` on the actual request field.
 *
 * 2. FABRICATED CHECKLIST (progress structurally 0/4)
 *    The response scored completion against `IT_ticket`, `task_complete`,
 *    `meet_and_greet_with_team` and `onboarding_status` — NONE of which exist in
 *    Sheet1. Column J is `welcome_status`. So `completed` was always `[]`,
 *    `percent_complete` always 0, and `total_items` was the hardcoded
 *    `checklist.length` = 4 while the sheet's `total_essentials` said 3.
 *    Fix: derive totals from the sheet's real columns and stop inventing
 *    per-item names the sheet cannot support.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export {};

const GATE_NODE = "Stage Update Requested?";
const PREPARE_NODE = "Prepare Onboarding Response";

/** Places a n8n export of this workflow has been found on this machine. */
const CANDIDATE_SOURCES = [
  "C:/Users/ashut/Downloads/Kilo/Check Onboarding Progress.json",
  "C:/Users/ashut/Downloads/Check Onboarding Progress.json",
  "C:/Users/ashut/Downloads/Archive/Check Onboarding Progress.json",
];

const DEFAULT_OUT_DIR = "specs/001-people-ops-portal/workflows";

const sourcePath = process.argv[2]
  ? resolve(process.argv[2])
  : CANDIDATE_SOURCES.find((p) => existsSync(p));

if (!sourcePath || !existsSync(sourcePath)) {
  console.error(
    "Source workflow not found. Pass a path:\n" +
      "  npx tsx scripts/build-fixed-onboarding-workflow.ts <source.json>\n\n" +
      "Looked in:\n  " +
      CANDIDATE_SOURCES.map((p) => `  ${p}${existsSync(p) ? "" : "  (missing)"}`).join("\n  "),
  );
  process.exitCode = 1;
} else {
  const outDir = resolve(process.argv[3] ?? DEFAULT_OUT_DIR);
  const wf = JSON.parse(readFileSync(sourcePath, "utf8"));

  const gate = wf.nodes.find((n: { name: string }) => n.name === GATE_NODE);
  const prepare = wf.nodes.find((n: { name: string }) => n.name === PREPARE_NODE);
  if (!gate) throw new Error(`"${GATE_NODE}" node not found in ${sourcePath}`);
  if (!prepare) throw new Error(`"${PREPARE_NODE}" node not found in ${sourcePath}`);

  /* -- Fix 1: the always-true gate --------------------------------------- */
  gate.parameters = {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
      conditions: [
        {
          id: "84340db4-567b-485e-9a4b-8514928bd31b",
          leftValue: "={{ $json.body.onboarding_stage }}",
          rightValue: "",
          operator: { type: "string", operation: "notEmpty", name: "filter.operator.notEmpty" },
        },
      ],
      combinator: "and",
    },
    options: {},
  };
  gate.notes =
    'FIXED: was leftValue:"" / rightValue:"" with equals, so "" === "" was ALWAYS true and every read wrote an empty string to the sheet. Now requires a non-empty body.onboarding_stage.';

  /* -- Fix 2: stop fabricating the checklist ------------------------------ */
  prepare.parameters.jsCode = [
    "// Prepare Onboarding Response",
    "// FIXED 2026-10-03.",
    "//",
    "// The previous version scored progress against four columns — IT_ticket,",
    "// task_complete, meet_and_greet_with_team, onboarding_status — NONE of which",
    "// exist in Sheet1. Every item therefore read as not-done, so completed was",
    "// always [], percent_complete always 0, and total_items was the hardcoded",
    "// checklist.length (4) while the sheet's own total_essentials said 3.",
    "//",
    "// This version reports only what the sheet actually holds. Sheet1 columns:",
    "//   total_essentials (G), completed_essentials (H, a formula counting the",
    "//   chips in I), onboarding_stage (I, multi-value chips), welcome_status (J).",
    "",
    "const input = $input.first()?.json ?? {};",
    "const body = $('Onboarding Progress API').first()?.json?.body ?? {};",
    "",
    "const temp_emp_id = String(body.temp_emp_id ?? input.temp_emp_id ?? '').trim();",
    "",
    "if (!temp_emp_id) {",
    "  return [{",
    "    json: {",
    "      status: 'error',",
    "      message: 'temp_emp_id is required'",
    "    }",
    "  }];",
    "}",
    "",
    "if (!input.temp_emp_id) {",
    "  return [{",
    "    json: {",
    "      status: 'not_found',",
    "      message: `No onboarding record found for ${temp_emp_id}.`,",
    "      temp_emp_id",
    "    }",
    "  }];",
    "}",
    "",
    "// Sheet numerics arrive as strings; tolerate blanks and stray characters.",
    "const num = (v) => {",
    "  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));",
    "  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;",
    "};",
    "",
    "const totalItems = num(input.total_essentials) ?? 0;",
    "const completedCount = num(input.completed_essentials) ?? 0;",
    "",
    "// Column I is a multi-value chips column. Those chips are the only per-item",
    "// signal the sheet carries, so they are reported as-is instead of being mapped",
    "// onto invented item names. Sheet1 has no per-item checklist columns; until it",
    "// does, 'outstanding' can only echo the chips that are not completion states.",
    "const chips = String(input.onboarding_stage ?? '')",
    "  .split(',')",
    "  .map((c) => c.trim())",
    "  .filter(Boolean);",
    "",
    "const DONE = /^(complete|completed|done|finished)$/i;",
    "const completed = chips.filter((c) => DONE.test(c));",
    "const outstanding = chips.filter((c) => !DONE.test(c));",
    "",
    "const percent = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;",
    "",
    "const requestedStage = body.onboarding_stage;",
    "const requestedStageUpdate =",
    "  requestedStage !== undefined &&",
    "  String(requestedStage).trim() !== '';",
    "",
    "return [{",
    "  json: {",
    "    status: 'success',",
    "    temp_emp_id,",
    "    name: input.name ?? null,",
    "    role: input.role ?? null,",
    "    onboarding_stage: String(input.onboarding_stage ?? '').trim(),",
    "",
    "    // Deliberately null. There is no onboarding_status column in Sheet1, and",
    "    // welcome_status means 'the welcome email was sent' — a DIFFERENT fact.",
    "    // Reporting one as the other would tell HR a hire has onboarded when only",
    "    // their email went out.",
    "    onboarding_status: null,",
    "    welcome_status: input.welcome_status ?? null,",
    "",
    "    percent_complete: percent,",
    "    completed_count: completedCount,",
    "    total_items: totalItems,",
    "    completed,",
    "    outstanding,",
    "",
    "    // Lets the BFF distinguish 'no progress recorded' from 'the sheet has no",
    "    // per-item data to report'.",
    "    checklist_source: chips.length > 0 ? 'onboarding_stage' : 'none',",
    "",
    "    can_update_stage: true,",
    "    requested_stage_update: requestedStageUpdate,",
    "    message: `Onboarding progress retrieved for ${temp_emp_id}.`",
    "  }",
    "}];",
    "",
  ].join("\n");
  prepare.notes =
    "FIXED: scored against four nonexistent columns (IT_ticket, task_complete, meet_and_greet_with_team, onboarding_status), forcing total_items=4 and completion 0/4. Now derives totals from total_essentials / completed_essentials and reports the real onboarding_stage chips.";

  // Make the copy obvious in the n8n UI.
  wf.name = "Check Onboarding Progress (FIXED 2026-10-03)";

  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "Check Onboarding Progress - FIXED.json");
  writeFileSync(outPath, JSON.stringify(wf, null, 2), "utf8");

  console.log(`source : ${sourcePath}  (NOT modified)`);
  console.log(`output : ${outPath}`);
  console.log(`gate   : ${JSON.stringify(gate.parameters.conditions.conditions[0].operator)} on body.onboarding_stage`);
  console.log(`nodes  : ${wf.nodes.map((n: { name: string }) => n.name).join(" | ")}`);
  console.log(`name   : ${wf.name}   -> ${basename(dirname(outPath))}/`);
}