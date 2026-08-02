/**
 * AI Benchmark CI entrypoint — pure fixture evaluation (no network / no DB).
 *
 * How to add a suite
 * ------------------
 * 1. Add suite + fixtures in `src/academic/ai/benchmarkSuite.ts`
 *    (`BUILTIN_BENCHMARK_SUITES` / `BUILTIN_BENCHMARK_FIXTURES`).
 * 2. Extend `evaluateFixture` with pure local checks for the suite_id.
 * 3. Mark `critical: true` only when it must block prompt/provider promotion.
 * 4. Mirror suite metadata in SQL seeds when promoting to control-plane.
 * 5. Run: `npm run test:ai-benchmarks`
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vitest", "run", "src/academic/ai/benchmarkCi.test.ts"],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
