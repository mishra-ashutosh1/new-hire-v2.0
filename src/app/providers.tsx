"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * TanStack Query provider (T023).
 *
 * The tracker needs per-query state, independent row resolution, a polling
 * interval, focus refetch, and per-query retry. RSC has no primitive for any of
 * these — `router.refresh()` re-runs the entire route's server tree on every
 * tick, which is precisely the wrong model for a fan-out view.
 */

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            staleTime: 0,
            retry: 1, // one retry; the BFF already retries upstream once
            refetchInterval: 30_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}