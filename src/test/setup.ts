import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";

// findBy* and waitFor give up after 1 s by default. Under the full suite's
// load a screen can take longer than that to draw what a test waits for, and
// the test fails on timing, not on behaviour (measured 2026-10-10: four files
// failed in one full run and passed alone). A wait for something that never
// comes still fails. The test's own budget is in vitest.config.ts.
configure({ asyncUtilTimeout: 5_000 });

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
