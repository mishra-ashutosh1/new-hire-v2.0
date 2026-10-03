import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Shared UI primitives (T021).
 *
 * These read design tokens exclusively — no hex values anywhere in this file.
 * shadcn components would normally land here, but they are retargeted to our
 * tokens so the library never becomes a second design system.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent-500 text-surface-canvas hover:bg-accent-400 active:bg-accent-600",
  secondary:
    "bg-surface-overlay text-text-primary border border-border-subtle hover:border-border-strong",
  ghost: "bg-transparent text-text-secondary hover:bg-surface-overlay hover:text-text-primary",
  danger: "bg-status-danger/14 text-status-danger border border-status-danger/40",
};

const SIZES: Record<Size, string> = {
  // min-h-11 (44px) on every size satisfies FR-028 touch targets.
  sm: "min-h-11 px-3 text-caption",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-11 px-5 text-body",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  disabled,
  children,
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      // `disabled` while busy is not cosmetic: the admin form creates a real
      // employee record and a double POST creates two (FR-014).
      disabled={disabled || busy}
      aria-busy={busy}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium
        transition-colors duration-[120ms] active:scale-[0.98] rounded-md
        disabled:opacity-50 disabled:cursor-not-allowed
        ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="size-3 rounded-full border-2 border-current border-r-transparent animate-spin"
        />
      )}
      {children}
    </button>
  );
}