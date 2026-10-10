import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // The whole suite runs ~200 jsdom files across every core, and the heaviest
    // screens (a practice session walked over three questions) take 1.8 s alone
    // but passed 5 s, the default, under that load — measured 2026-10-10. A
    // timed-out test also keeps running and clicks through the next test's
    // screen. A wait for something that never happens still fails; it fails
    // later. testing-library's own wait is raised to match in src/test/setup.ts.
    testTimeout: 20_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
