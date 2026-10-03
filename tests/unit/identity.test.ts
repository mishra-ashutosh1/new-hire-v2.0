/**
 * Role resolution after sign-in (T083).
 *
 * This is the authorization boundary. A bug here does not produce an error — it
 * produces a valid session with the wrong reach, over live employee data. So the
 * tests below are mostly about what must be REFUSED.
 *
 * The governing rule: a verified Google account proves who someone is, never what
 * they may see. Authority comes from HR_ADMIN_EMAILS / MANAGER_EMAILS only.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  adminEmails,
  isGoogleAuthConfigured,
  managerEmails,
  oauthRedirectUri,
  resolveIdentity,
  UnrecognizedIdentityError,
  describeAuthConfig,
  type RosterIdentity,
} from "@/lib/auth/identity";

const ROSTER: RosterIdentity[] = [
  { id: "1201", email: "employee@company.com" },
  { id: "1302", email: "test.user@company.com" },
  { id: "1303", email: null },
];

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
  delete process.env.HR_ADMIN_EMAILS;
  delete process.env.MANAGER_EMAILS;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
});

describe("admin allowlist", () => {
  it("grants hr_admin to a listed address", () => {
    const restore = env({ HR_ADMIN_EMAILS: "hr.admin@company.com" });
    const result = resolveIdentity("hr.admin@company.com", ROSTER);
    restore();
    expect(result.role).toBe("hr_admin");
    // hr_admin sees everything, so a scope would be meaningless.
    expect(result.scopedEmployeeIds).toBeNull();
  });

  it("matches case-insensitively, because email addresses are not case-sensitive", () => {
    const restore = env({ HR_ADMIN_EMAILS: "HR.Admin@Company.COM" });
    const result = resolveIdentity("hr.admin@company.com", ROSTER);
    restore();
    expect(result.role).toBe("hr_admin");
  });

  it("tolerates whitespace, commas AND a trailing comma", () => {
    // Hand-edited lists always have one. Losing the LAST entry silently would
    // lock the newest admin out with no clue why.
    const restore = env({ HR_ADMIN_EMAILS: "a@company.com, b@company.com ," });
    expect(adminEmails()).toEqual(["a@company.com", "b@company.com"]);
    const result = resolveIdentity("b@company.com", ROSTER);
    restore();
    expect(result.role).toBe("hr_admin");
  });

  it("attaches selfId when the admin is also an employee", () => {
    const restore = env({ HR_ADMIN_EMAILS: "employee@company.com" });
    const result = resolveIdentity("employee@company.com", ROSTER);
    restore();
    expect(result.selfId).toBe("1201");
  });
});

describe("manager allowlist", () => {
  it("scopes a manager to their own reporting line", () => {
    const restore = env({ MANAGER_EMAILS: "employee@company.com" });
    const result = resolveIdentity("employee@company.com", ROSTER);
    restore();
    expect(result.role).toBe("manager");
    expect(result.scopedEmployeeIds).toEqual(["1201"]);
  });

  it("gives a manager with no roster row an empty scope, not everyone", () => {
    // The failure mode to avoid is defaulting to null, which `canViewEmployee`
    // treats as "no scope" but a careless future change could treat as "all".
    const restore = env({ MANAGER_EMAILS: "boss@company.com" });
    const result = resolveIdentity("boss@company.com", ROSTER);
    restore();
    expect(result.scopedEmployeeIds).toEqual([]);
  });

  it("checks admins BEFORE managers, so an admin listed in both wins", () => {
    const restore = env({
      HR_ADMIN_EMAILS: "boss@company.com",
      MANAGER_EMAILS: "boss@company.com",
    });
    const result = resolveIdentity("boss@company.com", ROSTER);
    restore();
    expect(result.role).toBe("hr_admin");
  });
});

describe("everyone else", () => {
  it("scopes an unknown-but-employed address to their own row", () => {
    const result = resolveIdentity("test.user@company.com", ROSTER);
    expect(result.role).toBe("new_hire");
    expect(result.selfId).toBe("1302");
    expect(result.scopedEmployeeIds).toEqual(["1302"]);
  });

  it("REFUSES an address that is neither allowlisted nor in the roster", () => {
    // The critical case. Defaulting here to any role would hand the whole portal
    // to anyone who can create a Google account.
    expect(() => resolveIdentity("stranger@gmail.com", ROSTER)).toThrow(
      UnrecognizedIdentityError,
    );
  });

  it("does not match a roster row that has no email", () => {
    expect(() => resolveIdentity("unknown@company.com", ROSTER)).toThrow(
      UnrecognizedIdentityError,
    );
  });

  it("refuses an empty email", () => {
    expect(() => resolveIdentity("   ", ROSTER)).toThrow(UnrecognizedIdentityError);
  });

  it("refuses when the roster could not be read", () => {
    // An unreadable roster must NOT degrade to "admin" or to a signed-in new hire.
    expect(() => resolveIdentity("employee@company.com", [])).toThrow(
      UnrecognizedIdentityError,
    );
  });

  it("gives an employee with NO allowlist entry new_hire scope, never admin", () => {
    // Misconfiguration must fail closed. An employee on neither list is still a
    // legitimate user — they see their OWN row and nothing else. What must never
    // happen is a missing allowlist escalating anyone.
    const result = resolveIdentity("employee@company.com", ROSTER);
    expect(result.role).toBe("new_hire");
    expect(result.scopedEmployeeIds).toEqual(["1201"]);
    expect(adminEmails()).toEqual([]);
    expect(managerEmails()).toEqual([]);
  });
});

describe("a role can never come from the identity provider", () => {
  it("ignores a role-like email local part", () => {
    // Someone registering hr_admin@company.com as a Google account must gain
    // nothing, because the allowlist is empty here.
    expect(() => resolveIdentity("hr_admin@company.com", ROSTER)).toThrow(
      UnrecognizedIdentityError,
    );
  });

  it("grants nothing to an address that merely looks like the admin's", () => {
    const restore = env({ HR_ADMIN_EMAILS: "hr.admin@company.com" });
    expect(() => resolveIdentity("hr.admin@company.com.evil.com", ROSTER)).toThrow(
      UnrecognizedIdentityError,
    );
    restore();
  });
});

describe("configuration reporting", () => {
  it("reports NOT configured when the OAuth client is absent", () => {
    expect(isGoogleAuthConfigured()).toBe(false);
    expect(describeAuthConfig()).toMatch(/NOT configured/);
  });

  it("is configured only when BOTH id and secret are present", () => {
    const a = env({ GOOGLE_CLIENT_ID: "id" });
    expect(isGoogleAuthConfigured()).toBe(false);
    const b = env({ GOOGLE_CLIENT_SECRET: "secret" });
    expect(isGoogleAuthConfigured()).toBe(true);
    a();
    b();
  });

  it("never prints an address, only counts", () => {
    // The allowlist is a list of employee addresses, so this string can end up in
    // a log or an error message.
    const restore = env({
      HR_ADMIN_EMAILS: "secret.person@company.com",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    });
    const described = describeAuthConfig();
    restore();
    expect(described).not.toContain("secret.person@company.com");
    expect(described).toContain("1 admin");
  });

  it("prefers an explicit redirect URI over one derived from the request", () => {
    // Proxies rewrite Host, and a redirect_uri mismatch is silent.
    const restore = env({ GOOGLE_OAUTH_REDIRECT_URI: "https://hr.example.com/api/auth/google/callback" });
    expect(oauthRedirectUri("http://localhost:3000")).toBe(
      "https://hr.example.com/api/auth/google/callback",
    );
    restore();
  });

  it("derives the redirect URI from the request when unset", () => {
    expect(oauthRedirectUri("http://localhost:3000/tracker")).toBe(
      "http://localhost:3000/api/auth/google/callback",
    );
  });

  it("refuses to guess a redirect URI with no request and no config", () => {
    expect(() => oauthRedirectUri()).toThrow(/GOOGLE_OAUTH_REDIRECT_URI/);
  });
});