import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NavDrawer } from "@/components/layout/NavDrawer";
import { Providers } from "./providers";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "People Operations",
  description: "Internal onboarding and policy portal",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Providers>
          {/*
            Nav visibility is PRESENTATION ONLY. Every route independently
            enforces authorization server-side — hiding an item is not access
            control (FR-023).
          */}
          <div className="flex min-h-dvh flex-col lg:flex-row">
            <NavDrawer />
            <main className="min-w-0 flex-1 p-4 lg:p-6">
              <div className="mx-auto w-full max-w-[1400px]">{children}</div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}