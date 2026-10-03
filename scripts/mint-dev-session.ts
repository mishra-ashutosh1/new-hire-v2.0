import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Mints a portal_session cookie for local dev so the UI can be viewed without
 * a login page. Uses the SAME HMAC the app verifies, so this is a real signed
 * session - not a stub header that would bypass the auth check.
 *
 * Dev-only. Never wire this into the app.
 *
 * TWO CORRECTIONS 2026-10-03 — both were silently broken:
 *
 * 1. The third role was minted as `employee`, which is NOT a valid `Role`
 *    (`hr_admin | manager | new_hire`). Every request made with that cookie was
 *    refused with 403 `role "employee" cannot access tracker`, so the new-hire
 *    view of the UI had never actually been reachable — it looked like a working
 *    dev fixture and exercised nothing. The app was RIGHT to refuse it; the
 *    fixture was wrong.
 * 2. The manager scope was `['EMP001','EMP002']`, which matches no `temp_emp_id`
 *    in the roster (the real ones are `1201`, `1202`, `1301`, `1302`), so the
 *    manager view resolved to an empty roster rather than to a reporting line.
 *
 * `selfId` is included for the new hire because `Session.selfId` is what lets
 * `canViewEmployee` identify WHICH record is theirs. Without it a new hire can be
 * authorized onto a module but can never resolve their own row — see
 * `src/lib/auth/session.ts`.
 */
const env = readFileSync('.env.local', 'utf8');
const SECRET = env.match(/^SESSION_SECRET=(.*)$/m)?.[1]?.trim();

if (!SECRET) {
  throw new Error('SESSION_SECRET is not set in .env.local');
}

type Role = 'hr_admin' | 'manager' | 'new_hire';

function mint(role: Role, email: string, scoped: string[] | null, selfId?: string) {
  if (!SECRET) throw new Error('SESSION_SECRET missing');
  const session: Record<string, unknown> = { email, role, scopedEmployeeIds: scoped };
  if (selfId) session.selfId = selfId;
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Real `temp_emp_id` values from Sheet1. A scope of invented ids matches nothing. */
const REAL_ID = process.env.DEV_REAL_EMP_ID ?? '1201';

const out = {
  hr_admin: mint('hr_admin', 'hr.admin@company.com', null),
  manager: mint('manager', 'manager@company.com', [REAL_ID]),
  new_hire: mint('new_hire', 'new.hire@company.com', null, REAL_ID),
};

writeFileSync('scripts/.dev-session.json', JSON.stringify(out, null, 2));
console.log('minted 3 roles -> scripts/.dev-session.json');
console.log('  hr_admin  -> whole roster');
console.log(`  manager   -> scoped to [${REAL_ID}]`);
console.log(`  new_hire  -> selfId ${REAL_ID}`);
console.log('hr_admin cookie length:', out.hr_admin.length);
console.log('(secret used: ' + SECRET.length + ' chars, value not printed)');
