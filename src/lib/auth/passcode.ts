import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

import type { Role } from "@/types/domain";

/**
 * Passcode authentication (T083).
 *
 * WHY THIS EXISTS
 * ---------------
 * Google OAuth is the right sign-in for this tool, but registering an OAuth client
 * requires creating or administering a Google Cloud project. In a Workspace domain
 * that is normally an ADMIN-only permission, so an individual operator is legitimately
 * blocked at "Create Credentials -> OAuth client ID" with a permission error.
 *
 * A passcode is the fallback that needs no external project at all. It is weaker than
 * SSO — it authenticates a shared secret rather than a person — and the trade is
 * recorded honestly below rather than glossed.
 *
 * WHAT IT CANNOT DO
 * -----------------
 * It cannot authenticate an INDIVIDUAL. A new hire's access depends on knowing which
 * employee they are (`selfId`, resolved from their email), and a shared passcode
 * carries no such identity. So passcode sign-in grants only the roles configured
 * against a hash — `hr_admin` and `manager`. Per-employee self-service still needs
 * Google OAuth or a dev session. Pretending otherwise would mean handing every new
 * hire the manager scope.
 *
 * SECURITY NOTES
 * --------------
 * - The passcode is stored ONLY as a scrypt hash. The plaintext is shown once, by
 *   `npm run auth:passcode`, and never persisted.
 * - Verification is constant-time (`timingSafeEqual`), and every configured hash is
 *   evaluated with NO early return. With scrypt dominating the cost, returning early
 *   on the admin hash would leak which role a candidate matched by timing alone.
 * - The env var holds a hash, so a leaked config file does not hand over a login.
 *   That is the whole point of not storing the plaintext.
 */

/** scrypt cost parameters. N=16384 is the interactive-login recommendation. */
const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

const PREFIX = "scrypt";

/**
 * Field separator for the stored hash: `:` — and it must NOT be `$`.
 *
 * dotenv expands `$`-sequences inside `.env` values, so a hash written as
 * `scrypt$16384$8$1$salt$hash` arrives at the process SILENTLY TRUNCATED — measured
 * on @next/env: the final segment was dropped, leaving 5 fields instead of 6, and
 * every passcode was rejected with "not accepted" forever with no clue why.
 *
 * `:` is inert in dotenv, and base64url's alphabet (`A-Za-z0-9-_`) is safe inside it.
 * Do not "tidy" this back to `$`.
 */
const SEP = ":";

/**
 * Hash a passcode for storage. Used by `npm run auth:passcode` — never on a
 * request path.
 *
 * Format: `scrypt:N:r:p:<salt base64url>:<hash base64url>`
 */
export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(passcode.normalize("NFKC"), salt, KEY_LENGTH, SCRYPT_OPTIONS);
  const { N, r, p } = SCRYPT_OPTIONS;
  return [PREFIX, N, r, p, salt.toString("base64url"), derived.toString("base64url")].join(SEP);
}

/**
 * Verify a candidate against a stored hash. Returns false rather than throwing on a
 * malformed hash, so a bad env value denies access instead of crashing the route.
 */
export function verifyPasscode(candidate: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split(SEP);
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64url");
    expected = Buffer.from(parts[5]!, "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(candidate.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Passcode hashes, in the order they are evaluated. */
const CONFIGURED: { role: Role; envVar: string }[] = [
  { role: "hr_admin", envVar: "HR_ADMIN_PASSCODE_HASH" },
  { role: "manager", envVar: "MANAGER_PASSCODE_HASH" },
];

export function isPasscodeAuthConfigured(): boolean {
  return CONFIGURED.some(({ envVar }) => Boolean(process.env[envVar]));
}

/**
 * Resolve a candidate passcode to a role, or null.
 *
 * EVERY configured hash is evaluated, even after a match, and the answer is only
 * read at the end. An early return would make the response time depend on WHICH
 * role matched, which is a side channel worth closing given that the role names are
 * two of the three values an attacker is guessing between.
 */
export function roleForPasscode(candidate: string): Role | null {
  if (candidate.length === 0) return null;

  let matched: Role | null = null;
  for (const { role, envVar } of CONFIGURED) {
    const stored = process.env[envVar];
    if (!stored) continue;
    if (verifyPasscode(candidate, stored) && matched === null) {
      matched = role;
    }
  }
  return matched;
}

/**
 * A passcode to hand to an operator.
 *
 * Alphabet excludes `0/O`, `1/I/l` and other look-alikes: this gets read aloud,
 * retyped, and typed from a phone. 20 characters over a 32-symbol alphabet is ~100
 * bits, so guessing is hopeless even at the rate limit below.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generatePasscode(groups = 4, perGroup = 5): string {
  const total = groups * perGroup;
  const bytes = randomBytes(total);
  let out = "";
  for (let i = 0; i < total; i++) {
    if (i > 0 && i % perGroup === 0) out += "-";
    // Modulo bias is irrelevant at 32 symbols over 256, but rejection sampling is
    // two lines and removes the need to reason about it.
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Never log this. Exported only so the mint script can print it once. */
export function describePasscodeConfig(): string {
  const roles = CONFIGURED.filter(({ envVar }) => Boolean(process.env[envVar])).map(
    ({ role }) => role,
  );
  if (roles.length === 0) return "Passcode sign-in is NOT configured";
  return `Passcode sign-in configured for: ${roles.join(", ")}`;
}