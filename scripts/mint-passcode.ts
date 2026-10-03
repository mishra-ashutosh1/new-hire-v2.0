import { generatePasscode, hashPasscode } from "../src/lib/auth/passcode";

/**
 * Generate a passcode and its hash for `npm run auth:passcode`.
 *
 * Prints the PLAINTEXT once. It is never stored anywhere — only the hash goes into
 * the environment — so this is the ONLY chance to copy it.
 *
 * Scrypt with N=16384 takes ~100ms here, which is why this is synchronous and
 * single-shot.
 */

const roleArg = (process.argv[2] ?? "hr_admin").trim();
const role = roleArg === "manager" ? "manager" : "hr_admin";

const envVar = role === "manager" ? "MANAGER_PASSCODE_HASH" : "HR_ADMIN_PASSCODE_HASH";

if (process.argv.includes("--check")) {
  const stored = process.env[envVar];
  console.log(`${envVar}: ${stored ? "SET" : "NOT SET"}`);
  process.exit(stored ? 0 : 1);
}

const passcode = generatePasscode();
const hash = hashPasscode(passcode);

console.log(`\n  Passcode (shown ONCE — copy it now):\n`);
console.log(`      ${passcode}\n`);
console.log(`  Add this to .env.local (the HASH, not the passcode):\n`);
console.log(`      ${envVar}=${hash}\n`);
console.log(`  Role granted: ${role}`);
console.log(`  Does NOT authenticate an individual — no selfId, so no employee self-service.`);
console.log(`  Rotate by rerunning this script; the old hash stops working immediately.\n`);