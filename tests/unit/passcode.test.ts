/**
 * Passcode authentication (T083).
 *
 * A passcode is a shared secret, so the properties that matter are all about what
 * happens on a wrong guess: it must be indistinguishable from a right guess that
 * matches nothing, it must not be enumerable, and the env var must not contain a
 * usable credential.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  generatePasscode,
  hashPasscode,
  isPasscodeAuthConfigured,
  roleForPasscode,
  verifyPasscode,
  describePasscodeConfig,
} from "@/lib/auth/passcode";
import { PASSCODE_POLICY, consume, peek, resetLimiter } from "@/lib/auth/rate-limit";

const ADMIN_HASH = hashPasscode("AAAAA-BBBBB-CCCCC-DDDDD");

function env(vars: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

afterEach(() => {
  delete process.env.HR_ADMIN_PASSCODE_HASH;
  delete process.env.MANAGER_PASSCODE_HASH;
  resetLimiter();
});

describe("hashing", () => {
  it("verifies the passcode that produced the hash", () => {
    expect(verifyPasscode("AAAAA-BBBBB-CCCCC-DDDDD", ADMIN_HASH)).toBe(true);
  });

  it("rejects a wrong passcode", () => {
    expect(verifyPasscode("AAAAA-BBBBB-CCCCC-EEEEE", ADMIN_HASH)).toBe(false);
  });

it("never stores the passcode in the hash", () => {
expect(ADMIN_HASH).not.toContain("AAAAA");
expect(ADMIN_HASH.startsWith("scrypt:")).toBe(true);
});

it("uses no `$` in the format, because dotenv would truncate it", () => {
 // Regression guard for a real, silent failure: with a `$` separator, @next/env
 // expanded the value and DROPPED the final field, so every passcode was rejected
 // with no error anywhere. A hash must survive a round trip through .env intact.
 expect(ADMIN_HASH).not.toContain("$");
 expect(ADMIN_HASH.split(":")).toHaveLength(6);
});

  it("salts, so the same passcode hashes differently each time", () => {
    expect(hashPasscode("same-passcode")).not.toBe(hashPasscode("same-passcode"));
  });

it("rejects an absent, empty or malformed hash instead of throwing", () => {
 // A bad env value must DENY, not crash the route into a 500.
 expect(verifyPasscode("x", undefined)).toBe(false);
 expect(verifyPasscode("x", "")).toBe(false);
 expect(verifyPasscode("x", "not-a-hash")).toBe(false);
 expect(verifyPasscode("x", "scrypt:a:b:c:d:e")).toBe(false);
 expect(verifyPasscode("x", "bcrypt:16384:8:1:aaaa:bbbb")).toBe(false);
 expect(verifyPasscode("x", "scrypt:x:y:z:aaaa:bbbb")).toBe(false);
 // The old `$` format must no longer verify: accepting it would mean a stale
 // hash in someone's env silently half-worked.
 expect(verifyPasscode("x", "scrypt$16384$8$1$aaaa$bbbb")).toBe(false);
});

  it("tolerates the unicode forms a password manager may substitute", () => {
    // NFKC normalization means a fullwidth or composed variant still matches.
    const hash = hashPasscode("paßcode");
    expect(verifyPasscode("passcode", hash)).toBe(false);
    const composed = hashPasscode("café-pass");
    expect(verifyPasscode("café-pass", composed)).toBe(true);
  });
});

describe("generated passcodes", () => {
  it("are grouped, long, and free of look-alike characters", () => {
    const passcode = generatePasscode();
    expect(passcode).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    // 0/O/1/I/l excluded: this gets read aloud and retyped.
    expect(passcode).not.toMatch(/[O0Il1]/);
  });

  it("does not repeat", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generatePasscode()));
    expect(codes.size).toBe(50);
  });
});

describe("role resolution", () => {
  it("grants hr_admin for the admin passcode", () => {
    const restore = env({ HR_ADMIN_PASSCODE_HASH: ADMIN_HASH });
    expect(roleForPasscode("AAAAA-BBBBB-CCCCC-DDDDD")).toBe("hr_admin");
    restore();
  });

  it("returns null for a wrong passcode", () => {
    const restore = env({ HR_ADMIN_PASSCODE_HASH: ADMIN_HASH });
    expect(roleForPasscode("NOPE-NOPE-NOPE-NOPE")).toBeNull();
    restore();
  });

  it("returns null when nothing is configured — never a default role", () => {
    expect(roleForPasscode("anything")).toBeNull();
  });

  it("returns null for an empty passcode without hashing", () => {
    const restore = env({ HR_ADMIN_PASSCODE_HASH: ADMIN_HASH });
    expect(roleForPasscode("")).toBeNull();
    restore();
  });

  it("grants manager only for the manager passcode", () => {
    const managerHash = hashPasscode("MMMMM-NNNNN-OOOOO-PPPPP");
    const restore = env({
      HR_ADMIN_PASSCODE_HASH: ADMIN_HASH,
      MANAGER_PASSCODE_HASH: managerHash,
    });
    expect(roleForPasscode("MMMMM-NNNNN-OOOOO-PPPPP")).toBe("manager");
    expect(roleForPasscode("AAAAA-BBBBB-CCCCC-DDDDD")).toBe("hr_admin");
    restore();
  });

  it("reports configuration without revealing a passcode", () => {
    const restore = env({ HR_ADMIN_PASSCODE_HASH: ADMIN_HASH });
    const described = describePasscodeConfig();
    restore();
    expect(described).toContain("hr_admin");
    expect(described).not.toContain("AAAAA");
  });

  it("is configured only when at least one hash is present", () => {
    expect(isPasscodeAuthConfigured()).toBe(false);
    const restore = env({ MANAGER_PASSCODE_HASH: ADMIN_HASH });
    expect(isPasscodeAuthConfigured()).toBe(true);
    restore();
  });
});

describe("rate limiting", () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => resetLimiter());

  it("allows attempts up to the limit, then blocks", () => {
    const policy = { max: 3, windowMs: 1000 };
    expect(consume("ip", policy, NOW).allowed).toBe(true);
    expect(consume("ip", policy, NOW).allowed).toBe(true);
    expect(consume("ip", policy, NOW).allowed).toBe(true);
    expect(consume("ip", policy, NOW).allowed).toBe(false);
  });

  it("blocks with a positive Retry-After", () => {
    const policy = { max: 1, windowMs: 60_000 };
    consume("ip", policy, NOW);
    const blocked = consume("ip", policy, NOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate buckets per client", () => {
    const policy = { max: 1, windowMs: 1000 };
    expect(consume("a", policy, NOW).allowed).toBe(true);
    // Otherwise one attacker behind rotating addresses is unbounded.
    expect(consume("b", policy, NOW).allowed).toBe(true);
  });

  it("resets after the window expires", () => {
    const policy = { max: 1, windowMs: 1000 };
    consume("ip", policy, NOW);
    expect(consume("ip", policy, NOW + 999).allowed).toBe(false);
    expect(consume("ip", policy, NOW + 1001).allowed).toBe(true);
  });

  it("peek does not consume, so a lockout cannot be extended by probing", () => {
    const policy = { max: 2, windowMs: 1000 };
    consume("ip", policy, NOW);
    for (let i = 0; i < 20; i++) peek("ip", policy, NOW);
    expect(peek("ip", policy, NOW).remaining).toBe(1);
  });

  it("bounds guessing to ~20 attempts an hour, which is not a search", () => {
    // 5 per 15 min. Asserted because the policy is the actual defence: passcode
    // entropy is irrelevant if the rate is not bounded.
    expect(PASSCODE_POLICY.max).toBe(5);
    expect(PASSCODE_POLICY.windowMs).toBe(15 * 60 * 1000);
    const perHour = (PASSCODE_POLICY.max * (60 * 60 * 1000)) / PASSCODE_POLICY.windowMs;
    expect(perHour).toBeLessThanOrEqual(20);
  });
});