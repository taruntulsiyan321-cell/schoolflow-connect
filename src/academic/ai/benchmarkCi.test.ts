/**
 * Benchmark CI — vitest wrapper around pure gate evaluation.
 * See scripts/run-ai-benchmarks.mjs header for how to add suites.
 */

import { describe, expect, it } from "vitest";
import {
  runBuiltinBenchmarkSuites,
  evaluateFixture,
  BUILTIN_BENCHMARK_FIXTURES,
  criticalSuiteIds,
} from "./benchmarkSuite";

describe("AI Benchmark CI", () => {
  it("passes all built-in fixtures", () => {
    for (const f of BUILTIN_BENCHMARK_FIXTURES) {
      const r = evaluateFixture(f);
      expect(r.passed, `${f.suite_id}/${f.fixture_key}: ${r.detail}`).toBe(true);
    }
  });

  it("passes critical promotion gate", () => {
    const run = runBuiltinBenchmarkSuites();
    expect(criticalSuiteIds().length).toBeGreaterThanOrEqual(3);
    expect(run.gate.gate_passed).toBe(true);
    expect(run.gate.failed_suites).toEqual([]);
    expect(run.gate.missing_suites).toEqual([]);
  });
});
