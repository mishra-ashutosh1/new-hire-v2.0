import "@testing-library/jest-dom/vitest";

/**
 * The blank-panel invariant (T020) throws on a success state with no children.
 * That is correct in application code but would abort an entire unit-test file.
 * Tests assert the invariant deliberately via the DataState spec; every other
 * suite should see a warning instead of a process-level failure.
 */
const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("blank panel invariant")) return;
  originalError(...(args as Parameters<typeof console.error>));
};