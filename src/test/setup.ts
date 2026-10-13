import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";

// findBy* and waitFor give up after 1 s by default. Under the full suite's
// load a screen can take longer than that to draw what a test waits for, and
// the test fails on timing, not on behaviour (measured 2026-10-10: four files
// failed in one full run and passed alone). A wait for something that never
// comes still fails. The test's own budget is in vitest.config.ts.
configure({ asyncUtilTimeout: 5_000 });

// TESTS DO NOT REACH THE NETWORK. Until 2026-10-13 any call a test left
// unmocked went to PRODUCTION Supabase: every full run sent a few hundred
// anonymous requests with fixture ids ("u", "u1"), which filled the live error
// log (KNOWN_ISSUES 132). 71 tests in 10 files did; all pass with this guard,
// which answers every absolute http(s) request with a network failure.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/^https?:\/\//.test(url)) {
    return Promise.reject(new TypeError(`Tests do not reach the network: ${url}`));
  }
  return realFetch(input, init);
}) as typeof fetch;

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
