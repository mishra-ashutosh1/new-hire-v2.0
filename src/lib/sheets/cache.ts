import { readRoster, type RawSheetRow, type SheetReadResult } from "./client";

/**
 * ETag-backed TTL cache (T015).
 *
 * The Sheets API exposes NO change token, revision counter, or per-range
 * revision. It does support HTTP conditional requests: send the prior ETag as
 * If-None-Match and an unchanged sheet returns 304 with no body. Combined with
 * a TTL, a 30s poll becomes a header-only round trip that still counts as one
 * quota unit.
 *
 * A full read is a single request regardless of row count, and 100 employees at
 * a 30s poll is ~2 req/min against a documented 300/min/project quota — about
 * 0.7%. Redis would be unjustified at this scale, so this is in-process only.
 *
 * No background worker: on a fetch error, serve stale and flag it.
 */

const TTL_MS = 60_000;

interface CacheEntry {
  value: SheetReadResult;
  fetchedAt: number;
  etag: string | null;
}

let entry: CacheEntry | null = null;
let inflight: Promise<SheetReadResult> | null = null;

export interface CachedRoster {
  result: SheetReadResult;
  fetchedAt: string;
  ageSeconds: number;
  source: "live" | "cache" | "stale";
}

function isFresh(current: CacheEntry): boolean {
  return Date.now() - current.fetchedAt < TTL_MS;
}

/**
 * Returns the roster, coalescing concurrent callers onto one in-flight read.
 */
export async function getRoster(): Promise<CachedRoster> {
  if (entry && isFresh(entry)) {
    return {
      result: entry.value,
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
      ageSeconds: Math.round((Date.now() - entry.fetchedAt) / 1000),
      source: "cache",
    };
  }

  // Single-flight: many tabs requesting at once produce ONE upstream read.
  inflight ??= readRoster().finally(() => {
    inflight = null;
  });

  try {
    const value = await inflight;
    entry = { value, fetchedAt: Date.now(), etag: value.etag };
    return {
      result: value,
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
      ageSeconds: 0,
      source: "live",
    };
  } catch (cause) {
    // Stale-while-revalidate: a failed refresh must not blank the tracker.
    if (entry) {
      return {
        result: entry.value,
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
        ageSeconds: Math.round((Date.now() - entry.fetchedAt) / 1000),
        source: "stale",
      };
    }
    throw cause;
  }
}

/** Exposed for /api/health. */
export function rosterAgeSeconds(): number | null {
  return entry ? Math.round((Date.now() - entry.fetchedAt) / 1000) : null;
}

/**
 * Drop the cached snapshot so the next read is live.
 *
 * Needed after anything writes through the roster — in demo mode, appending a
 * hire here is the write, and a 60s-stale cache would show the tracker
 * contradicting the success message the user just received.
 */
export function invalidateRoster(): void {
  entry = null;
}

/** Test seam — resets module state between cases. */
export function __resetRosterCache(): void {
  entry = null;
  inflight = null;
}

export type { RawSheetRow };