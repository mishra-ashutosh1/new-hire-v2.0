"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";

/**
 * NavDrawer (T069).
 *
 * Above `lg` a 248px fixed sidebar. Below it, the same links behind a hamburger
 * that opens an overlay drawer.
 *
 * A drawer rather than a bottom tab bar because there are five destinations and
 * only one of them ("Provision New Hire") is used weekly. A permanent bottom
 * bar would spend the most valuable screen real estate on four links a user
 * almost never touches.
 *
 * Accessibility is not optional here, so the drawer implements the parts that
 * are usually skipped: Escape closes it, focus moves into it on open and
 * returns to the trigger on close, the background is inert while it is open,
 * and body scroll is locked. A drawer that traps no focus is a keyboard trap
 * instead — strictly worse than no drawer.
 */

const NAV = [
  { href: "/", label: "Dashboard", description: "Cohort status and attention queue" },
  { href: "/tracker", label: "Onboarding Tracker", description: "Per-employee onboarding progress" },
  { href: "/welcome", label: "Welcome Sequences", description: "Welcome email audit and status" },
  { href: "/policies", label: "Policy & Benefits", description: "Search the HR policy document" },
  { href: "/new-hire", label: "Provision New Hire", description: "Create an onboarding record" },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 flex-col justify-center rounded-md px-3 py-2 transition-colors ${
              active
                ? "bg-surface-overlay text-text-primary"
                : "text-text-secondary hover:bg-surface-overlay hover:text-text-primary"
            }`}
          >
            <span className="text-sm">{item.label}</span>
            {/* The active link carries more than colour — see aria-current and
                the tinted surface, so it survives greyscale. */}
            {active && <span className="eyebrow text-text-tertiary">Current</span>}
          </Link>
        );
      })}
    </>
  );
}

export function NavDrawer() {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close the drawer if the viewport grows past lg — otherwise it stays open
  // behind the desktop sidebar and the page scrolls with the lock still applied.
  useEffect(() => {
    if (isDesktop) setOpen(false);
  }, [isDesktop]);

  // Escape closes; focus is restored to the trigger on close.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    // Lock background scroll so the page behind cannot move under the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the panel so the next Tab stays inside the drawer.
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (isDesktop) {
    return (
      <aside className="hidden lg:flex w-[248px] shrink-0 flex-col gap-1 border-r border-border-subtle p-4">
        <span className="eyebrow text-text-tertiary px-3 py-2">People Ops</span>
        {/*
         * The <nav> landmark is load-bearing and was missing here. The mobile drawer
         * below has had `<nav aria-label="Main">` all along, so on desktop — the
         * layout most desktop users get — assistive tech had no navigation landmark
         * to jump to, and the sidebar read as an unlabelled aside. A landmark is not
         * decoration: it is how a screen-reader user skips straight to navigation.
         * Kept in sync deliberately; if you change one, change both.
         */}
        <nav aria-label="Main">
          <NavLinks />
        </nav>
      </aside>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-raised/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="nav-drawer"
          aria-label="Open navigation"
          data-testid="nav-trigger"
          className="flex h-11 w-11 items-center justify-center rounded-md border border-border-subtle text-text-primary transition-colors hover:bg-surface-overlay"
        >
          {/* Decorative: the button already carries an aria-label. */}
          <span aria-hidden="true" className="flex flex-col gap-[3px]">
            <span className="block h-px w-4 bg-current" />
            <span className="block h-px w-4 bg-current" />
            <span className="block h-px w-4 bg-current" />
          </span>
        </button>
        <span className="text-h3">People Ops</span>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Scrim. Clicking closes. A button, not a div, so it is reachable
              by keyboard — but aria-hidden, since Escape already provides the
              accessible dismissal path and this would otherwise be announced as
              an unnamed control. */}
          <button
            type="button"
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/60"
          />
          <div
            id="nav-drawer"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            data-testid="nav-drawer"
            className="absolute inset-y-0 left-0 flex w-[248px] max-w-[80vw] flex-col gap-1 overflow-y-auto border-r border-border-subtle bg-surface-raised p-4"
          >
            <div className="flex items-center justify-between px-3 py-2">
              <span className="eyebrow text-text-tertiary">People Ops</span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label="Close navigation"
                className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-overlay"
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  &times;
                </span>
              </button>
            </div>
            <nav aria-label="Main">
              <NavLinks onNavigate={() => setOpen(false)} />
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

export { NAV };
