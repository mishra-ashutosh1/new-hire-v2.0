/**
 * ============================================================================
 *  ONBOARDING WEBHOOK  —  Apps Script receiver for the n8n admin workflow
 * ============================================================================
 *
 *  Bind this file TO the spreadsheet: Extensions > Apps Script, then delete the
 *  contents of Code.gs and paste this whole file in.
 *
 *  SHEET COLUMNS — this script does not rename, reorder or redesign anything.
 *  Existing columns, in the order they are expected to be found:
 *
 *      temp_emp_id, name, role, start_date, cohort, emailID,
 *      total_essentials, completed_essentials, onboarding_stage, welcome_status
 *
 *  `welcome_status` is READ-ONLY for this script. It is never written, never
 *  parsed as a stage, and never renamed. It holds welcome-email state
 *  (e.g. "welcome_sent"), which is a different fact from onboarding progress.
 *
 *  WHAT setUp() DOES
 *  -----------------
 *    NOTHING. It is a READ-ONLY AUDIT. It does not insert, delete, rename,
 *    reorder, reformat or backfill anything, and it never creates a column. It
 *    only reads and prints: the column inventory, whether each expected column
 *    resolves, duplicate temp_emp_id values, blank required fields, id storage
 *    types, stage values outside the allowlist, total_essentials anomalies,
 *    whether onboarding_stage is a Chips column, and whether the deployment
 *    secret is set (presence only — the value is never printed).
 *
 *    It was originally written as a provisioning step that would append two
 *    columns. That was removed deliberately: the Welcome, Admin and Onboarding
 *    Progress workflows all work against the current structure, and a setup
 *    routine that can silently alter a live sheet is a larger risk than the two
 *    derived columns were worth.
 *
 *    A regression test substitutes a sheet whose every mutating method throws,
 *    so a write reintroduced here fails the suite rather than the sheet.
 *
 *  ONBOARDING_STAGE: THREE VALUES IN THE SHEET, SEVEN IN THE APP
 *  -----------------------------------------------------------
 *  The sheet stores three human-facing buckets; the app keeps seven fine
 *  stages and collapses them on the way in:
 *
 *      not_started            -> "Not Started"
 *      it_setup               -> "In Progress"   |
 *      orientation            -> "In Progress"    |
 *      meet_and_greet         -> "In Progress"    | five fine stages collapse
 *      task_complete          -> "In Progress"    | into one sheet bucket
 *      status_confirmed       -> "In Progress"   |
 *      complete               -> "Completed"
 *
 *  The reverse map is LOSSY and is never the authority. The n8n onboarding
 *  webhook remains the source for the fine stage; the sheet bucket is read only
 *  as a degraded fallback, and a fallback must be conservative rather than
 *  optimistic — so "In Progress" resolves to the EARLIEST in-progress stage
 *  (it_setup), never to the last known one. Guessing "the last stage we saw"
 *  would require storing that stage somewhere, which is a second source of
 *  truth.
 *
 *  CHIPS
 *  -----
 *  Apps Script CANNOT create or validate a Chips column. This script therefore
 *  validates the value ITSELF against an allowlist and rejects anything else
 *  with HTTP 400, and it reports at run time whether the column really is
 *  chips. Because it writes a validated plain string, it behaves identically
 *  whether or not the column is chips.
 *
 *  AUTHENTICATION
 *  --------------
 *  Apps Script cannot read custom request headers (the event object exposes
 *  only postData, parameter and contentLength), so the shared secret travels as
 *  ?token=... The deployment must be "Anyone" because n8n Cloud is external and
 *  has no Google identity — which makes this token the only thing between the
 *  public internet and a PII sheet. It must be long and random, and the script
 *  fails CLOSED when it is unset.
 *
 *  DEPLOYMENT
 *  ----------
 *  Deploy > New deployment > Web app: Execute as Me, Access Anyone.
 *  Use the /exec URL. RE-DEPLOY after any change; edits do not take effect
 *  until you create a new version. setUp() is a diagnostic and is not a
 *  deployment prerequisite.
 */

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

var CONFIG = {
  // Pinning the tab is load-bearing: Sheet2 is a byte-identical mirror, and an
  // unpinned or wrong-tab read doubles every employee.
  SHEET_NAME: 'Sheet1',

  // Query-string key carrying the shared secret.
  TOKEN_PARAM: 'token',

  // The key column. Resolved BY NAME, never by index — a hardcoded index would
  // write the stage into someone's email column the day the order changes.
  KEY_COLUMN: 'temp_emp_id',

  // Only these may be written by a webhook. An allowlist, not a denylist: adding
  // a PII column to the sheet must not automatically make it remotely writable.
  // NOTE: welcome_status and completed_essentials are deliberately ABSENT.
  WRITABLE_COLUMNS: ['name', 'role', 'start_date', 'cohort', 'emailID', 'total_essentials', 'onboarding_stage'],

  // Columns this script owns. Derived from the stage on the row, so they can
  // never disagree with it, and never accepted from the payload.
  STAGE_COLUMN: 'onboarding_stage',
  STATUS_COLUMN: 'onboarding_progress_status',
  SYNCED_COLUMN: 'last_synced_at',

  // Read-only columns. Listed so an accidental write attempt is a loud
  // error rather than a silent overwrite.
  READ_ONLY_COLUMNS: ['temp_emp_id', 'welcome_status', 'completed_essentials']
};

// Assigned AFTER CONFIG, because the list is built from values inside it.
// Referring to CONFIG from within its own object literal evaluates against an
// undefined CONFIG.
//
// onboarding_stage is deliberately NOT listed: it is the one column the webhook
// exists to write, and listing it as read-only would make the two definitions
// contradict each other.
CONFIG.READ_ONLY_COLUMNS = CONFIG.READ_ONLY_COLUMNS.concat([
  CONFIG.STATUS_COLUMN,
  CONFIG.SYNCED_COLUMN
]);

var ALLOWED_STAGES = ['Not Started', 'In Progress', 'Completed'];

var STATUS_COMPLETED = '100% onboarding completed';

// Fine stage -> sheet bucket. Seven -> three.
var STAGE_TO_SHEET = {
  not_started: 'Not Started',
  it_setup: 'In Progress',
  orientation: 'In Progress',
  meet_and_greet: 'In Progress',
  task_complete: 'In Progress',
  status_confirmed: 'In Progress',
  complete: 'Completed'
};

// Sheet bucket -> fine stage. Three -> seven, deliberately conservative.
var SHEET_TO_STAGE = {
  'not started': 'not_started',
  'in progress': 'it_setup',
  'completed': 'complete'
};

// Monotonic ordering. A transition must strictly advance, so a misfired webhook
// cannot walk a completed hire back to "Not Started".
var STAGE_RANK = { 'not started': 0, 'in progress': 1, 'completed': 2 };

// Script Properties keys.
var PROP_TOKEN = 'WEBHOOK_SECRET';
var PROP_ALLOW_BACKWARD = 'ALLOW_BACKWARD_TRANSITIONS';

// ---------------------------------------------------------------------------
// ENTRY POINTS
// ---------------------------------------------------------------------------

/**
 * GET - liveness probe. Returns no data and no configuration.
 */
function doGet(e) {
  return json_({
    ok: true,
    service: 'onboarding-webhook',
    stage_values: ALLOWED_STAGES
  });
}

/**
 * POST - the webhook receiver.
 *
 * Uses the same three-state vocabulary as the portal's BFF
 * (success | not_found | error), so an n8n response can be forwarded onward
 * without re-interpretation.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    var secret = requireSecret_();
    if (!secret) {
      return json_({
        status: 'error',
        code: 'NOT_CONFIGURED',
        message: 'Webhook secret is not configured. Set the WEBHOOK_SECRET Script Property.'
      }, 503);
    }

    var supplied = e && e.parameter ? e.parameter[CONFIG.TOKEN_PARAM] : '';
    if (!safeEquals_(String(supplied || ''), secret)) {
      // 401, not 403: the caller has not proven identity at all.
      return json_({ status: 'error', code: 'UNAUTHENTICATED', message: 'Invalid webhook token.' }, 401);
    }

    var payload = parseBody_(e);
    if (!payload) {
      return json_({ status: 'error', code: 'MALFORMED_BODY', message: 'Request body must be a JSON object.' }, 400);
    }

    var update = validate_(payload);
    if (update.error) {
      return json_({ status: 'error', code: 'VALIDATION_FAILED', message: update.error, detail: update.detail }, 400);
    }

    // Serialise concurrent webhooks. Two simultaneous read-modify-writes on the
    // same row would otherwise interleave.
    lock.waitLock(20000);

    var sheet = getSheet_();
    if (!sheet) {
      return json_({
        status: 'error',
        code: 'SHEET_UNAVAILABLE',
        message: 'Spreadsheet or tab not found: ' + CONFIG.SHEET_NAME
      }, 503);
    }

    var located = findRow_(sheet, update.temp_emp_id);
    if (located.rowIndex === 0) {
      // A missing row is NOT a failure. The hire may simply not be onboarded
      // yet, and an error here would make n8n retry forever.
      return json_({
        status: 'not_found',
        code: 'NO_SUCH_EMPLOYEE',
        message: 'No row matches ' + CONFIG.KEY_COLUMN + ' = ' + update.temp_emp_id,
        temp_emp_id: update.temp_emp_id
      }, 404);
    }

    return applyUpdate_(sheet, located.row, located.rowIndex, update);

  } catch (err) {
    return json_({
      status: 'error',
      code: 'INTERNAL',
      message: (err && err.message) ? err.message : 'Unexpected error.',
      detail: (err && err.stack) ? String(err.stack).split('\n').slice(0, 3).join(' | ') : undefined
    }, 500);

  } finally {
    try { lock.releaseLock(); } catch (ignored) { /* never held */ }
  }
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

/**
 * Validates a payload into a safe, allowlisted update.
 * Returns {error, detail} on rejection, otherwise {temp_emp_id, updates}.
 *
 * Rejects the WHOLE payload on the first invalid field. A partial write is
 * worse than a refusal: the sheet and the webhook would quietly disagree and
 * nothing would report it.
 */
function validate_(payload) {
  var tempEmpId = firstDefined_([
    payload.temp_emp_id,
    payload.tempEmpId,
    payload.emp_id,
    payload.id
  ]);

  if (tempEmpId === null || tempEmpId === undefined || String(tempEmpId).trim() === '') {
    return {
      error: CONFIG.KEY_COLUMN + ' is required.',
      detail: 'Received keys: ' + Object.keys(payload).join(', ')
    };
  }

  // The sheet stores this as text in some rows and a number in others, so it is
  // always compared as a trimmed string. Never coerce to Number: a long id or
  // a leading zero would silently lose digits.
  var id = String(tempEmpId).trim();

  var updates = {};

  if (Object.prototype.hasOwnProperty.call(payload, CONFIG.STAGE_COLUMN)) {
    var stage = canonicalStage_(payload[CONFIG.STAGE_COLUMN]);
    if (!stage) {
      return {
        error: 'Unsupported ' + CONFIG.STAGE_COLUMN + '.',
        detail: 'Allowed values: ' + ALLOWED_STAGES.join(', ')
      };
    }
    updates[CONFIG.STAGE_COLUMN] = stage;
  }

  var optional = [
    { column: 'name', kind: 'text' },
    { column: 'role', kind: 'text' },
    { column: 'start_date', kind: 'text' },
    { column: 'cohort', kind: 'text' },
    { column: 'emailID', kind: 'email' },
    { column: 'total_essentials', kind: 'non_negative_integer' }
  ];

  for (var i = 0; i < optional.length; i++) {
    var column = optional[i].column;
    if (!Object.prototype.hasOwnProperty.call(payload, column)) continue;

    var raw = payload[column];
    // Blank means "leave it alone" - an omitted email must not blank a real
    // address already in the sheet.
    if (raw === null || raw === undefined || raw === '') continue;

    if (optional[i].kind === 'non_negative_integer') {
      var n = Number(raw);
      if (!isFinite(n) || n < 0 || Math.floor(n) !== n) {
        return { error: column + ' must be a non-negative integer.', detail: 'Received: ' + raw };
      }
      updates[column] = n;
      continue;
    }

    if (optional[i].kind === 'email') {
      var address = String(raw).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        return { error: column + ' is not a valid email address.', detail: 'Received: ' + address };
      }
      updates[column] = address;
      continue;
    }

    updates[column] = String(raw).trim();
  }

  // Refuse anything aimed at a column this script does not own. Silently
  // ignoring it would let a caller believe they had updated something.
  var attemptedReadOnly = Object.keys(payload).filter(function (key) {
    return CONFIG.READ_ONLY_COLUMNS.indexOf(key) !== -1 && key !== CONFIG.KEY_COLUMN;
  });

  if (attemptedReadOnly.length) {
    return {
      error: 'Cannot write read-only column(s): ' + attemptedReadOnly.join(', ') + '.',
      detail: 'Read-only: ' + CONFIG.READ_ONLY_COLUMNS.join(', ') +
        '. onboarding_progress_status and last_synced_at are derived from the stage automatically.'
    };
  }

  if (Object.keys(updates).length === 0) {
    return {
      error: 'No writable fields present.',
      detail: 'Writable columns: ' + CONFIG.WRITABLE_COLUMNS.join(', ') +
        ' (aliases for the key: tempEmpId, emp_id, id)'
    };
  }

  return { temp_emp_id: id, updates: updates };
}

/**
 * Maps any accepted spelling onto one of the three canonical sheet values.
 * Returns null for anything outside the allowlist.
 */
function canonicalStage_(value) {
  if (value === null || value === undefined) return null;

  var raw = String(value).trim();
  if (!raw) return null;

  var key = raw.toLowerCase().replace(/[\s_-]+/g, ' ');

  if (key === 'not started') return 'Not Started';
  if (key === 'in progress') return 'In Progress';
  if (key === 'completed') return 'Completed';

  // Accept the app's seven snake_case stage names too, so n8n may send either
  // vocabulary without anyone having to know which one the sheet uses.
  if (Object.prototype.hasOwnProperty.call(STAGE_TO_SHEET, raw)) return STAGE_TO_SHEET[raw];

  return null;
}

// ---------------------------------------------------------------------------
// SHEET ACCESS
// ---------------------------------------------------------------------------

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  return ss.getSheetByName(CONFIG.SHEET_NAME);
}

/**
 * Header-based column lookup. Indices are NEVER hardcoded.
 */
function headerMap_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return {};

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var map = {};

  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i]).trim();
    if (!name) continue;
    map[normalizeHeader_(name)] = i + 1;
  }
  return map;
}

/** Case, whitespace, hyphen and underscore insensitive. */
function normalizeHeader_(name) {
  return String(name).trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

/** Resolves a column name to its 1-based index, or 0 if absent. */
function columnIndex_(map, name) {
  var key = normalizeHeader_(name);
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : 0;
}

/**
 * Finds the single row whose temp_emp_id matches, scanning the key column only.
 * A duplicate is an error naming both rows rather than writing to an arbitrary
 * one - that is how a hire gets lost.
 */
function findRow_(sheet, tempEmpId) {
  var map = headerMap_(sheet);
  var keyColumn = columnIndex_(map, CONFIG.KEY_COLUMN);

  if (!keyColumn) {
    throw new Error('Column "' + CONFIG.KEY_COLUMN + '" was not found in the header row.');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { row: null, rowIndex: 0 };

  var values = sheet.getRange(2, keyColumn, lastRow - 1, 1).getValues();
  var matches = [];

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === tempEmpId) matches.push(i + 2);
  }

  if (matches.length === 0) return { row: null, rowIndex: 0 };
  if (matches.length > 1) {
    throw new Error(
      'Ambiguous ' + CONFIG.KEY_COLUMN + ' "' + tempEmpId + '" - found in rows ' +
      matches.join(', ') + '. Deduplicate before retrying.'
    );
  }

  return { row: values[matches[0] - 2], rowIndex: matches[0] };
}

// ---------------------------------------------------------------------------
// WRITE
// ---------------------------------------------------------------------------

function applyUpdate_(sheet, row, rowIndex, update) {
  var map = headerMap_(sheet);
  var warnings = [];
  var written = {};
  var changed = false;

  // 1. Reject a backward stage transition BEFORE writing anything.
  var stageColumn = columnIndex_(map, CONFIG.STAGE_COLUMN);
  var currentRaw = stageColumn ? String(row[stageColumn - 1]).trim() : '';

  if (Object.prototype.hasOwnProperty.call(update.updates, CONFIG.STAGE_COLUMN)) {
    var incoming = update.updates[CONFIG.STAGE_COLUMN];

    if (currentRaw) {
      var currentCanonical = canonicalStage_(currentRaw);
      var currentRank = currentCanonical ? STAGE_RANK[normalizeHeader_(currentCanonical)] : null;
      var incomingRank = STAGE_RANK[normalizeHeader_(incoming)];

      if (currentRank !== null && incomingRank < currentRank && !allowBackward_()) {
        return json_({
          status: 'error',
          code: 'NON_MONOTONIC_STAGE',
          message: 'Refused to move ' + CONFIG.STAGE_COLUMN + ' from "' + currentRaw + '" back to "' + incoming + '".',
          temp_emp_id: update.temp_emp_id,
          row: rowIndex
        }, 409);
      }
    }

    if (!stageColumn) {
      warnings.push('Column "' + CONFIG.STAGE_COLUMN + '" not found - stage was NOT written.');
    }
  }

  // 2. Write the payload's own fields.
  Object.keys(update.updates).forEach(function (column) {
    var index = columnIndex_(map, column);
    if (!index) {
      warnings.push('Column "' + column + '" not found in this sheet - not written.');
      return;
    }

    var value = update.updates[column];
    if (String(row[index - 1]) !== String(value)) changed = true;

    sheet.getRange(rowIndex, index).setValue(value);
    written[column] = value;
  });

  // 3. Derive the status cell from the stage NOW ON THE ROW, not from the
  //    payload, so the two can never disagree.
  var finalStage = Object.prototype.hasOwnProperty.call(update.updates, CONFIG.STAGE_COLUMN)
    ? update.updates[CONFIG.STAGE_COLUMN]
    : (stageColumn ? canonicalStage_(row[stageColumn - 1]) : null);

  var statusText = statusFor_(finalStage);

  var statusIndex = columnIndex_(map, CONFIG.STATUS_COLUMN);
  if (statusIndex) {
    sheet.getRange(rowIndex, statusIndex).setValue(statusText);
    written[CONFIG.STATUS_COLUMN] = statusText;
  } else {
    warnings.push(
      'Column "' + CONFIG.STATUS_COLUMN + '" not found - the completion indicator is not ' +
      'being persisted. Nothing breaks: the portal derives status from ' +
      CONFIG.STAGE_COLUMN + '. Add the column yourself if you want it stored.'
    );
  }

  var syncedIndex = columnIndex_(map, CONFIG.SYNCED_COLUMN);
  if (syncedIndex) {
    var now = new Date().toISOString();
    sheet.getRange(rowIndex, syncedIndex).setValue(now);
    written[CONFIG.SYNCED_COLUMN] = now;
  } else {
    warnings.push('Column "' + CONFIG.SYNCED_COLUMN + '" not found - freshness is not being stored.');
  }

  return json_({
    status: 'success',
    temp_emp_id: update.temp_emp_id,
    row: rowIndex,
    changed: changed,
    fields_written: written,
    warnings: warnings
  }, 200);
}

/**
 * The completion indicator. Driven by the stage on the row, so it can never
 * contradict the cell beside it.
 */
function statusFor_(stage) {
  if (!stage) return '';
  if (stage === 'Completed') return STATUS_COMPLETED;
  if (stage === 'In Progress') return 'Onboarding in progress';
  if (stage === 'Not Started') return 'Not started';
  return '';
}

// ---------------------------------------------------------------------------
// READ-ONLY AUDIT
// ---------------------------------------------------------------------------

/**
 * READ-ONLY SHEET AUDIT. Safe to run at any time, any number of times.
 *
 * THIS FUNCTION PERFORMS NO WRITES. It does not insert, delete, rename, reorder
 * or reformat any cell, and it does not create columns. It only reads and prints.
 *
 * It was originally written as a provisioning step that would append two columns.
 * That was removed deliberately: the Welcome, Admin and Onboarding Progress
 * workflows are all working against the current structure, and a setup routine
 * that can silently alter a live sheet is a larger risk than the two derived
 * columns were worth. Onboarding progress is derived from `onboarding_stage`
 * wherever it is displayed, so nothing needs persisting for it to show.
 */
function setUp() {
  function say(s) { Logger.log(s); }
  function head(s) { say(''); say('== ' + s + ' =='); }

  var sheet = getSheet_();
  if (!sheet) {
    throw new Error(
      'Sheet "' + CONFIG.SHEET_NAME + '" not found. This script must be BOUND to the spreadsheet ' +
      '(open the sheet > Extensions > Apps Script), then run again.'
    );
  }

  var map = headerMap_(sheet);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  say('==================================================');
  say(' onboarding-webhook  READ-ONLY AUDIT');
  say(' THIS RUN PERFORMED NO WRITES TO THE SHEET.');
  say('==================================================');
  say('Sheet: ' + CONFIG.SHEET_NAME + '   rows: ' + lastRow + '   columns: ' + lastColumn);

  // --- Structure -------------------------------------------------------
  head('STRUCTURE');

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  for (var h = 0; h < headers.length; h++) {
    var name = String(headers[h]).trim();
    say('  col ' + pad_(h + 1) + (name || '(BLANK HEADER)'));
  }

  say('');
  var required = ['temp_emp_id', 'name', 'role', 'start_date', 'cohort', 'emailID', 'total_essentials'];
  var missing = required.filter(function (c) { return !columnIndex_(map, c); });
  say(missing.length
    ? '  WARN  expected columns not found: ' + missing.join(', ')
    : '  OK    all expected columns present');

  [
    { name: 'onboarding_stage', why: 'the column this webhook writes' },
    { name: 'welcome_status', why: 'welcome-email state, read-only here' },
    { name: 'completed_essentials', why: 'read-only here' }
  ].forEach(function (spec) {
    var index = columnIndex_(map, spec.name);
    say(index
      ? '  OK    ' + spec.name + ' -> column ' + index + '  (' + spec.why + ')'
      : '  WARN  ' + spec.name + ' absent  (' + spec.why + ')');
  });

  // --- Derived columns: reported, never created ------------------------
  head('DERIVED COLUMNS (optional - never created by this script)');

  [CONFIG.STATUS_COLUMN, CONFIG.SYNCED_COLUMN].forEach(function (column) {
    var index = columnIndex_(map, column);
    say(index
      ? '  PRESENT  ' + column + ' -> column ' + index + ' (webhook will persist to it)'
      : '  ABSENT   ' + column + ' (webhook will NOT persist; status stays derived)');
  });

  say('');
  say('  Onboarding progress is derived from ' + CONFIG.STAGE_COLUMN +
      ' wherever it is displayed, so');
  say('  these columns are NOT required. If you ever want them persisted, add them');
  say('  yourself rather than letting a script alter a live sheet:');
  say('      ' + CONFIG.STATUS_COLUMN);
  say('      ' + CONFIG.SYNCED_COLUMN);

  // --- Key column ------------------------------------------------------
  head('KEY COLUMN');
  var keyColumn = columnIndex_(map, CONFIG.KEY_COLUMN);
  say(keyColumn
    ? '  OK    ' + CONFIG.KEY_COLUMN + ' -> column ' + keyColumn
    : '  FAIL  ' + CONFIG.KEY_COLUMN + ' not found - the webhook cannot match any row');

  // --- Row-level findings ---------------------------------------------
  head('ROW CHECKS');
  if (lastRow < 2) {
    say('  No data rows.');
  } else {
    reportDuplicates_(sheet, say);
    reportBlankFields_(sheet, say, map, lastRow);
    reportMixedTypes_(sheet, say, keyColumn, lastRow);
    reportStageValues_(sheet, say, map, lastRow);
    reportTotals_(sheet, say, map, lastRow);
  }

  // --- Chips -----------------------------------------------------------
  head('onboarding_stage COLUMN TYPE');
  reportChipStatus_(sheet, say);

  // --- Deployment readiness (never prints the secret) ------------------
  head('DEPLOYMENT');
  var hasSecret = !!PropertiesService.getScriptProperties().getProperty(PROP_TOKEN);
  say(hasSecret
    ? '  OK    WEBHOOK_SECRET is set (value not printed).'
    : '  WARN  WEBHOOK_SECRET is NOT set - doPost will refuse every request with 503');
  say('        while it is missing. That is intentional fail-closed behaviour.');

  say(allowBackward_()
    ? '  WARN  ALLOW_BACKWARD_TRANSITIONS=true - stages may move backwards'
    : '  OK    ALLOW_BACKWARD_TRANSITIONS is off - stage transitions are monotonic');

  head('RESULT');
  say('  No changes were made. Nothing above was written to the sheet.');
  say('  This audit is safe to re-run at any time.');
}

/** Read-only. Reports duplicate key values, naming the rows involved. */
function reportDuplicates_(sheet, say) {
  var keyColumn = columnIndex_(headerMap_(sheet), CONFIG.KEY_COLUMN);
  if (!keyColumn) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 3) {
    say('  OK    DUPLICATE IDS: only ' + Math.max(0, lastRow - 1) + ' data row(s) - nothing can conflict');
    return;
  }

  var values = sheet.getRange(2, keyColumn, lastRow - 1, 1).getValues();
  var seen = {};
  var dupes = [];

  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0]).trim();
    if (!id) continue;
    if (seen.hasOwnProperty(id)) {
      if (dupes.indexOf(id) === -1) dupes.push(id);
    } else {
      seen[id] = i + 2;
    }
  }

  if (dupes.length) {
    say('  FAIL  DUPLICATE IDS: ' + dupes.join(', ') +
        '. doPost refuses to write when a key is ambiguous, so these must be resolved.');
  } else {
    say('  OK    DUPLICATE IDS: ' + Object.keys(seen).length + ' unique id(s), none repeated');
  }
}

/** Read-only. Names rows with a blank required field. */
function reportBlankFields_(sheet, say, map, lastRow) {
  var required = ['temp_emp_id', 'name', 'emailID'];
  var lastColumn = sheet.getLastColumn();
  var grid = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  var issues = [];

  for (var r = 0; r < grid.length; r++) {
    for (var c = 0; c < required.length; c++) {
      var index = columnIndex_(map, required[c]);
      if (!index) continue;
      if (!String(grid[r][index - 1]).trim()) issues.push('row ' + (r + 2) + ' missing ' + required[c]);
    }
  }

  if (issues.length) {
    say('  WARN  BLANK REQUIRED FIELDS (' + issues.length + '):');
    issues.slice(0, 12).forEach(function (line) { say('        ' + line); });
    if (issues.length > 12) say('        ... and ' + (issues.length - 12) + ' more');
  } else {
    say('  OK    BLANK REQUIRED FIELDS: none in ' + required.join(', '));
  }
}

/**
 * Read-only. temp_emp_id is stored as both text and number across the sheet.
 * Not a bug - the webhook compares it as a trimmed string - but a future change
 * that coerced it to Number would corrupt long ids, so it is worth surfacing.
 */
function reportMixedTypes_(sheet, say, keyColumn, lastRow) {
  if (!keyColumn || lastRow < 2) return;

  var values = sheet.getRange(2, keyColumn, lastRow - 1, 1).getValues();
  var numeric = 0;
  var text = 0;

  for (var i = 0; i < values.length; i++) {
    var v = values[i][0];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'number') numeric++; else text++;
  }

  say('  NOTE  temp_emp_id types: ' + numeric + ' numeric, ' + text + ' text. ' +
      (numeric && text
        ? 'Mixed. Safe - the webhook compares as a trimmed string, but do not coerce to Number.'
        : 'Single type.'));
}

/** Read-only. Flags onboarding_stage values outside the allowlist. */
function reportStageValues_(sheet, say, map, lastRow) {
  var index = columnIndex_(map, CONFIG.STAGE_COLUMN);
  if (!index || lastRow < 2) return;

  var values = sheet.getRange(2, index, lastRow - 1, 1).getValues();
  var counts = {};
  var unknown = [];

  for (var i = 0; i < values.length; i++) {
    var raw = String(values[i][0]).trim();
    if (!raw) continue;
    if (canonicalStage_(raw)) {
      counts[raw] = (counts[raw] || 0) + 1;
    } else if (unknown.indexOf(raw) === -1) {
      unknown.push(raw);
    }
  }

  var summary = Object.keys(counts).length
    ? Object.keys(counts).map(function (k) { return k + '=' + counts[k]; }).join(', ')
    : '(all blank)';

  say('  ' + (unknown.length ? 'WARN ' : 'OK   ') + 'STAGE VALUES: ' + summary);

  if (unknown.length) {
    say('        Values OUTSIDE the allowlist: ' + unknown.join(', '));
    say('        doPost rejects any webhook that tries to write one of these.');
  }
}

/**
 * Read-only. total_essentials is blank in some rows, and the workflow has
 * reported a total_items vs total_essentials mismatch. Surfaced because a
 * discrepancy here silently changes the denominator of progress.
 */
function reportTotals_(sheet, say, map, lastRow) {
  var index = columnIndex_(map, 'total_essentials');
  if (!index || lastRow < 2) return;

  var values = sheet.getRange(2, index, lastRow - 1, 1).getValues();
  var blank = 0;
  var bad = 0;

  for (var i = 0; i < values.length; i++) {
    var v = values[i][0];
    if (v === null || v === undefined || String(v).trim() === '') { blank++; continue; }
    if (!isFinite(Number(v))) bad++;
  }

  say('  ' + (blank || bad ? 'NOTE ' : 'OK   ') + 'total_essentials: ' +
      blank + ' blank, ' + bad + ' non-numeric, ' + (values.length - blank - bad) + ' numeric');
  say('        A blank is treated as unknown, not as 0 - the tracker shows the');
  say('        discrepancy rather than reporting a confident 100%.');
}

/**
 * Read-only. Reports whether onboarding_stage really is a Chips column.
 *
 * Data validation is deliberately NOT applied: doing so would silently convert a
 * Chips column back to plain text. It is also not required - the webhook
 * validates every write itself.
 */
function reportChipStatus_(sheet, say) {
  var index = columnIndex_(headerMap_(sheet), CONFIG.STAGE_COLUMN);

  if (!index) {
    say('  FAIL  column "' + CONFIG.STAGE_COLUMN + '" not found.');
    return;
  }

  var type = 'plain text';
  try {
    var source = sheet.getRange(2, index).getDataSource();
    if (source) {
      var kind = String(source.getType());
      type = kind.indexOf('CHIP') !== -1 ? 'CHIPS' : kind;
    }
  } catch (err) {
    type = 'unknown (' + err.message + ')';
  }

  say('  ' + CONFIG.STAGE_COLUMN + ' column type = ' + type);
  say('  Allowed values: ' + ALLOWED_STAGES.join(' | '));

  if (type !== 'CHIPS') {
    say('');
    say('  OPTIONAL: convert it to Chips by hand if you want multi-select -');
    say('    select the column header > Insert > Chips.');
    say('  NOT required for correctness. The webhook validates every write against');
    say('  the allowlist and rejects anything else with HTTP 400.');
  }
}

/** Right-pads a column number so the listing aligns. */
function pad_(n) {
  var s = String(n);
  while (s.length < 3) s = ' ' + s;
  return s + ' ';
}

// ---------------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------------

function requireSecret_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_TOKEN);
}

function allowBackward_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_ALLOW_BACKWARD);
  return String(raw).toLowerCase() === 'true';
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return null;
  try {
    var parsed = JSON.parse(e.postData.contents);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch (err) {
    return null;
  }
}

/**
 * Comparison that does not short-circuit on the first differing character.
 * Length is compared first because there is no timingSafeEqual in Apps Script.
 */
function safeEquals_(a, b) {
  if (!b) return false;
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function firstDefined_(candidates) {
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] !== undefined && candidates[i] !== null) return candidates[i];
  }
  return null;
}

/**
 * Always returns JSON.
 *
 * Apps Script web apps CANNOT set an HTTP status code. TextOutput exposes only
 * setContentType, setMimeType and getAs, so every response arrives as HTTP 200
 * — including authentication failures, validation errors and NOT_FOUND.
 *
 * The intended status is therefore carried in the body as `http_status`,
 * alongside the `status` field (success | not_found | error). Callers MUST
 * branch on `status` and never on the HTTP code. The three-state vocabulary is
 * the contract; the HTTP code was never load-bearing.
 */
function json_(obj, code) {
  var body = {};
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) body[key] = obj[key];
  }
  if (code && code !== 200) body.http_status = code;

  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
