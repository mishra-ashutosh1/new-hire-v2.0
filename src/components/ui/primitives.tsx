import type { ReactNode } from "react";

/** Card, StatusBadge, ProgressBar, Skeleton (T021). */

export function Card({
  children,
  className = "",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-border-subtle bg-surface-raised p-6
        ${interactive ? "transition-shadow duration-[120ms] hover:shadow-md" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "unknown";

const TONE: Record<StatusTone, string> = {
  success: "bg-status-success/14 text-status-success",
  warning: "bg-status-warning/14 text-status-warning",
  danger: "bg-status-danger/14 text-status-danger",
  info: "bg-status-info/14 text-status-info",
  neutral: "bg-status-neutral/14 text-status-neutral",
  unknown: "bg-status-unknown/14 text-status-unknown",
};

/**
 * Status is ALWAYS paired with a text label. Color alone is never the carrier of
 * meaning (FR-029 / WCAG 1.4.1) — roughly 1 in 12 men has a color vision
 * deficiency, and onboarding status is exactly the information they must not
 * lose.
 */
export function StatusBadge({
  tone,
  label,
  icon,
}: {
  tone: StatusTone;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={`eyebrow inline-flex items-center gap-1.5 rounded-full px-2 py-1 ${TONE[tone]}`}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
    </span>
  );
}

export function ProgressBar({
  percent,
  label,
}: {
  /** 0–100. Clamped, because a malformed upstream value must not overflow. */
  percent: number;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay"
    >
      <div
        className="h-full rounded-full bg-accent-500 transition-[width] duration-[320ms]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Skeleton({ className = "h-6 w-full" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-md bg-surface-raised animate-pulse ${className}`} />;
}

/**
 * Hero progress ring. Rendered as SVG with an accessible text equivalent, so the
 * value is never conveyed by arc length alone.
 */
export function ProgressRing({
  percent,
  label,
  size = 132,
}: {
  percent: number;
  label: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} role="img" aria-label={`${label}: ${clamped}% complete`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-overlay"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="stroke-accent-500 transition-[stroke-dasharray] duration-[320ms]"
        />
      </svg>
      <span className="absolute text-h2 font-semibold text-text-primary">{clamped}%</span>
    </div>
  );
}