"use client";

import type { ReactNode } from "react";
import { useIsMobile } from "@/lib/hooks/useMediaQuery";

/**
 * ResponsiveTable (T068).
 *
 * A responsive table is a LAYOUT decision, not a library feature. Above `md` a
 * real <table> with sticky header; below it, the identical row data rendered as
 * stacked label/value cards.
 *
 * Horizontal scroll is explicitly the anti-pattern — it is why a mobile user
 * loses the columns they need most. One column definition drives both modes so
 * the two can never drift.
 */

export interface ResponsiveColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Primary column gets emphasis in the mobile card layout. */
  primary?: boolean;
}

export function ResponsiveTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  emptyMessage = "No records to display.",
}: {
  rows: readonly T[];
  columns: readonly ResponsiveColumn<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}) {
  const isMobile = useIsMobile();

  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary py-6">{emptyMessage}</p>;
  }

  if (isMobile) {
    return (
      <ul data-testid="card-list" className="flex flex-col gap-3">
        {rows.map((row) => {
          const key = rowKey(row);
          return (
            <li
              key={key}
              data-testid="card-item"
              className="rounded-lg border border-border-subtle bg-surface-raised p-4"
            >
              {onRowClick && (
                <button
                  type="button"
                  onClick={() => onRowClick(row)}
                  className="block w-full text-left min-h-11"
                >
                  {columns
                    .filter((c) => c.primary)
                    .map((c) => (
                      <span key={c.key} className="text-h3 text-text-primary">
                        {c.render(row)}
                      </span>
                    ))}
                </button>
              )}
              <dl className="mt-3 flex flex-col gap-2">
                {columns
                  .filter((c) => !c.primary)
                  .map((c) => (
                    <div key={c.key} className="flex flex-col gap-0.5">
                      <dt className="eyebrow text-text-tertiary">{c.header}</dt>
                      <dd className="text-sm text-text-primary">{c.render(row)}</dd>
                    </div>
                  ))}
              </dl>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-surface-raised z-10">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="eyebrow text-text-tertiary text-left border-b border-border-subtle px-4 py-3"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`h-12 border-b border-border-subtle transition-colors
                ${index % 2 === 0 ? "" : "bg-white/[0.04]"}
                ${onRowClick ? "cursor-pointer hover:bg-surface-overlay" : ""}`}
            >
              {columns.map((c) => (
                <td key={c.key} className="px-4 text-sm text-text-primary">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}