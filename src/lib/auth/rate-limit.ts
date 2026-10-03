/**
 * Fixed-window rate limiter for passcode attempts.
 *
 * A passcode is a shared secret, so its only real defence against guessing is that
 * an attacker cannot try fast enough. Without this, ~100 bits of entropy is
 * irrelevant because a script gets millions of attempts per minute. With it, the
 * search space stops mattering.
 *
 * WHAT THIS DOES NOT DO, STATED PLAINLY
 * ------------------------------------
 * State is in-process. That is honest for a single-instance internal tool and it is
 * a real weakness the moment this runs on two instances behind a load balancer,
 * where an attacker gets N times the attempts by spreading them. The fix is a shared
 * store (Redis, or the platform's rate limiter) — flagged in the deployment notes
 * rather than silently assumed away.
 *
 * Restarting the process also resets the counters. That is acceptable: it is an
 * attacker inconvenience, never a security boundary being removed.
 *
 * Both limits exist deliberately. The per-key limit stops one source hammering; the
 * per-IP limit is what actually bounds the search, since an attacker rotates source
 * addresses far more slowly than they rotate passcode guesses.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts left in the current window, for a neutral response. */
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const BUCKETS = new Map<string, Window>();

/** Sweep expired entries so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [key, window] of BUCKETS) {
    if (window.resetAt <= now) BUCKETS.delete(key);
  }
}

export interface LimitPolicy {
  /** Attempts allowed per window for one key. */
  max: number;
  /** Window length. */
  windowMs: number;
}

/**
 * @param key       identifies the caller (usually client IP)
 * @param policy    attempts and window
 */
export function consume(key: string, policy: LimitPolicy, now = Date.now()): RateLimitResult {
  sweep(now);

  const existing = BUCKETS.get(key);
  if (!existing || existing.resetAt <= now) {
    BUCKETS.set(key, { count: 1, resetAt: now + policy.windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, policy.max - 1),
      retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
    };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= policy.max,
    remaining: Math.max(0, policy.max - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Read without consuming. Used to report a lockout without extending it. */
export function peek(key: string, policy: LimitPolicy, now = Date.now()): RateLimitResult {
  const existing = BUCKETS.get(key);
  if (!existing || existing.resetAt <= now) {
    return { allowed: true, remaining: policy.max, retryAfterSeconds: 0 };
  }
  return {
    allowed: existing.count < policy.max,
    remaining: Math.max(0, policy.max - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Test seam. Production never resets the limiter. */
export function resetLimiter(): void {
  BUCKETS.clear();
}

/**
 * Policies.
 *
 * 5 per 15 minutes is the shape of a human who fumbled their passcode; a script
 * gets ~20 attempts an hour against ~100 bits of entropy, which is not a search.
 */
export const PASSCODE_POLICY: LimitPolicy = { max: 5, windowMs: 15 * 60 * 1000 };