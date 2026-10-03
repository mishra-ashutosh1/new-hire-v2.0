import { useEffect, useState } from "react";

/**
 * useMediaQuery (T022).
 *
 * The basis for responsive table rendering: above `md` a real <table>, below it
 * the identical row model as stacked cards. One column definition drives both.
 * A horizontally scrolled table on mobile is the explicit anti-pattern.
 */

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Matches the `md` breakpoint used by ResponsiveTable. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}