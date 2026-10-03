"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataState } from "@/components/data-state/DataState";
import { fetchJson } from "@/lib/api/fetcher";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/ResponsiveTable";
import { Button, Card, StatusBadge } from "@/components/ui";
import type { StatusTone } from "@/components/ui";

/**
 * Welcome audit view (T053, T054).
 *
 * This is an AUDIT tool, not a bulk-send console. Welcome status is therefore
 * the default column and the per-row action is secondary — most rows are
 * already provisioned, and a send-first layout would invite duplicate sends.
 *
 * `already_sent` renders GREEN. It is idempotent success, and presenting the
 * normal steady state as a warning would train HR to distrust the page.
 */

interface WelcomeRow {
  employee: { id: string; name: string; role: string | null; startDate: string | null };
  recordedStatus: string | null;
}

interface SendOutcome {
  status: "sent" | "already_sent" | "error";
  message: string;
  employeeId: string;
  employeeName?: string;
}

async function fetchWelcome(): Promise<{ rows: WelcomeRow[]; freshness: { ageSeconds: number; source: string } }> {
  return fetchJson<{ rows: WelcomeRow[]; freshness: { ageSeconds: number; source: string } }>(
    "/api/welcome",
  );
}

async function postWelcome(id: string): Promise<SendOutcome> {
  const response = await fetch(`/api/welcome/${encodeURIComponent(id)}`, { method: "POST" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string; employeeId?: string } }
      | null;
    return {
      status: "error",
      message: body?.error?.message ?? `request failed with HTTP ${response.status}`,
      employeeId: body?.error?.employeeId ?? id,
    };
  }
  return (await response.json()) as SendOutcome;
}

const STATUS_DISPLAY: Record<string, { tone: StatusTone; label: string }> = {
  welcome_sent: { tone: "success", label: "Welcome sent" },
  pending: { tone: "warning", label: "Pending" },
  not_started: { tone: "neutral", label: "Not started" },
};

export default function WelcomeAudit() {
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["welcome"], queryFn: fetchWelcome, refetchInterval: 60_000 });
  const rows = query.data?.rows ?? [];

  async function send(id: string, name: string) {
    setBusyId(id);
    setOutcome(null);
    try {
      const result = await postWelcome(id);
      setOutcome({ ...result, employeeName: name });
      await query.refetch();
    } finally {
      setBusyId(null);
    }
  }

  const columns: ResponsiveColumn<WelcomeRow>[] = [
    {
      key: "name",
      header: "Employee",
      primary: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-text-primary">{row.employee.name}</span>
          <span className="mono text-caption text-text-tertiary">{row.employee.id}</span>
        </div>
      ),
    },
    { key: "role", header: "Role", render: (row) => row.employee.role ?? "—" },
    {
      key: "startDate",
      header: "Start date",
      render: (row) => <span className="mono">{row.employee.startDate ?? "—"}</span>,
    },
    {
      key: "status",
      header: "Welcome status",
      render: (row) => {
        const status = row.recordedStatus ?? "not_started";
        const display = STATUS_DISPLAY[status] ?? { tone: "neutral" as StatusTone, label: status };
        return <StatusBadge tone={display.tone} label={display.label} />;
      },
    },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <Button
          size="sm"
          busy={busyId === row.employee.id}
          onClick={() => void send(row.employee.id, row.employee.name)}
        >
          Send welcome
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="eyebrow text-text-tertiary">Communications</span>
        <h1 className="text-h1">Welcome Sequences</h1>
        <p className="text-sm text-text-secondary">
          Audit which new hires have been processed. Sending is idempotent — an employee who has
          already received a welcome will report that, not fail.
        </p>
      </header>

      {/* T054: green for both sent and already_sent; the exact server wording. */}
      {outcome && (
        <div
          role="status"
          data-testid="welcome-outcome"
          className={`rounded-md border px-4 py-3 text-sm ${
            outcome.status === "error"
              ? "border-status-danger/40 bg-status-danger/10 text-status-danger"
              : "border-status-success/40 bg-status-success/10 text-status-success"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={outcome.status === "error" ? "danger" : "success"}
              label={
                outcome.status === "sent"
                  ? "Welcome sent"
                  : outcome.status === "already_sent"
                    ? "Already processed"
                    : "Failed"
              }
            />
            <span>{outcome.message}</span>
          </div>
          {outcome.employeeName && (
            <p className="mt-1 text-caption opacity-80">{`Employee: ${outcome.employeeName} (${outcome.employeeId})`}</p>
          )}
        </div>
      )}

      <Card>
        <DataState
          state={query.isPending ? "loading" : query.isError ? "error" : "success"}
          label="welcome status"
          errorMessage={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          hasContent={rows.length > 0}
          skeleton={<div className="h-24 w-full rounded-md bg-surface-raised animate-pulse" />}
        >
          <ResponsiveTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.employee.id}
            emptyMessage="No employees are currently being onboarded."
          />
        </DataState>
      </Card>
    </div>
  );
}