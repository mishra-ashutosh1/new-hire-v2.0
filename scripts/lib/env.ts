import { existsSync, readFileSync } from "node:fs";

/**
 * Load `.env.local` / `.env` into `process.env` for standalone scripts.
 *
 * Next.js populates `process.env` for the running app, but a bare `tsx` script
 * gets NOTHING — so `check-upstreams.ts` reported all five hard requirements as
 * FAIL while the app was perfectly healthy (observed 2026-10-03). A check that
 * always cries wolf gets ignored, which is worse than having no check.
 *
 * Existing `process.env` wins, so an explicitly exported variable overrides the
 * file. That is what makes `PROBE_EMP_ID=9999 npm run probe:upstreams` work.
 */
export function loadEnvFile(): void {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const key = match[1] as string;
      if (key in process.env) continue;
      let value = match[2] ?? "";
      // Strip surrounding quotes, tolerating the base64 service-account blob.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}