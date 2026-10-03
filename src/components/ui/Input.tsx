"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/**
 * Form inputs (T021). Labels are always visible above the field — never
 * placeholder-only, which loses the label on focus and fails WCAG 3.3.2.
 */

const FIELD =
  "w-full min-h-11 rounded-md bg-surface-input border border-border-strong px-3 text-sm " +
  "text-text-primary placeholder:text-text-tertiary transition-colors " +
  "focus:border-accent-500 focus:ring-2 focus:ring-accent-glow " +
  "disabled:opacity-50";

const INVALID = "border-status-danger focus:border-status-danger focus:ring-status-danger/20";

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-caption text-text-secondary font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-caption text-text-tertiary">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-caption text-status-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  invalid?: boolean;
}

export function TextInput({ id, invalid, className = "", ...rest }: TextInputProps) {
  return (
    <input
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      className={`${FIELD} ${invalid ? INVALID : ""} ${className}`}
      {...rest}
    />
  );
}

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  invalid?: boolean;
}

export function SelectInput({ id, invalid, className = "", children, ...rest }: SelectInputProps) {
  return (
    <select
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      className={`${FIELD} ${invalid ? INVALID : ""} ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}