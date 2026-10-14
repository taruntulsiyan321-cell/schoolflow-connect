import "@testing-library/jest-dom";
import { afterAll, afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { installNetworkGuard } from "./networkGuard";

// findBy* and waitFor give up after 1 s by default. Under the full suite's
// load a screen can take longer than that to draw what a test waits for, and
// the test fails on timing, not on behaviour (measured 2026-10-10: four files
// failed in one full run and passed alone). A wait for something that never
// comes still fails. The test's own budget is in vitest.config.ts.
configure({ asyncUtilTimeout: 5_000 });

// TESTS DO NOT REACH THE NETWORK (src/test/networkGuard.ts). A test that asks
// for an address fails, and the message names what to mock.
//
// Unmount first: a screen that sends something as it goes, such as a practice
// session's finish, sends it during cleanup, and that request belongs to this
// test. Then one real macrotask lets an async send reach fetch. The timer is
// captured here because a test may have left fake timers on.
const network = installNetworkGuard(globalThis);
const realSetTimeout = globalThis.setTimeout;
async function failOnReach(when: string) {
  cleanup();
  await new Promise((settle) => realSetTimeout(settle, 0));
  const urls = network.takeReached();
  if (urls.length) {
    throw new Error(`Tests do not reach the network; mock what ${when} called:\n  ${urls.join("\n  ")}`);
  }
}
afterEach(() => failOnReach("this test"));
afterAll(() => failOnReach("this file's last test"));

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
