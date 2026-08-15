import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLatestEffect } from "./useLatestEffect";

describe("useLatestEffect", () => {
  it("a run is not stale until a newer run has begun", () => {
    const { result } = renderHook(() => useLatestEffect());
    const isStale = result.current();
    expect(isStale()).toBe(false);
  });

  it("an older run becomes stale once a newer run begins", () => {
    const { result } = renderHook(() => useLatestEffect());
    const beginRun = result.current;
    const isStaleFirst = beginRun();
    const isStaleSecond = beginRun();
    expect(isStaleFirst()).toBe(true);
    expect(isStaleSecond()).toBe(false);
  });

  it("beginRun() itself is a stable reference across renders", () => {
    const { result, rerender } = renderHook(() => useLatestEffect());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
