import { describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, act } from "@testing-library/react";
import { useKeyedResource } from "./useKeyedResource";

/**
 * These tests pin down the stale-render hazard this hook exists to remove.
 *
 * `LegacyPanel` reproduces the pattern used across ~36 keyed panels in this
 * repo. `KeyedPanel` is the same screen written with `useKeyedResource`.
 *
 * HONEST SCOPE. The plain legacy pattern does NOT leak on an ordinary
 * click-driven switch: React flushes the passive effect (and therefore
 * `setLoading(true)`) before the browser paints, so the user sees a spinner.
 * The audit found no live instance of a visible one-frame flash, and the
 * second test below pins that correct behaviour down so it cannot regress.
 *
 * What IS demonstrably unsafe is the same pattern with a guard clause —
 * `if (!ready || !ctx) return;` — which this codebase uses widely. When the
 * guard is false the effect returns before clearing anything, so the previous
 * key's data stays on screen under the new key's heading. That is proven
 * below, and `useKeyedResource` is immune to it by construction.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The pattern currently used across the app, including the guard clause that
 * every panel here has in some form (`if (!ready || !ctx) return;`).
 */
function LegacyPanel({
  studentId,
  load,
  ready = true,
}: {
  studentId: string;
  load: (id: string) => Promise<string>;
  ready?: boolean;
}) {
  const [data, setData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The guard: returns before any state is reset.
    if (!ready) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await load(studentId);
      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, load, ready]);

  return (
    <div>
      <h1>{studentId}</h1>
      {loading ? <p>Loading…</p> : <p data-testid="body">{data}</p>}
    </div>
  );
}

/** The same screen through the presentation-safe loading primitive. */
function KeyedPanel({
  studentId,
  load,
  enabled = true,
}: {
  studentId: string;
  load: (id: string) => Promise<string>;
  enabled?: boolean;
}) {
  const res = useKeyedResource(studentId, (id) => load(id), { enabled });
  return (
    <div>
      <h1>{studentId}</h1>
      {res.isIdle && <p data-testid="idle">Select a child</p>}
      {res.isLoading && <p>Loading…</p>}
      {res.error && <p data-testid="error">{res.error}</p>}
      {res.isReady && <p data-testid="body">{res.data}</p>}
    </div>
  );
}

describe("the stale-render defect (documented, then fixed)", () => {
  it("BASELINE: the plain legacy pattern is safe on an ordinary switch (pinned so it cannot regress)", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = vi.fn((id: string) => (id === "child-a" ? first.promise : second.promise));

    const { rerender } = render(<LegacyPanel studentId="child-a" load={load} />);

    await act(async () => {
      first.resolve("Child A: 92% attendance");
      await first.promise;
    });
    expect(screen.getByTestId("body").textContent).toBe("Child A: 92% attendance");

    rerender(<LegacyPanel studentId="child-b" load={load} />);

    // React flushes the passive effect before paint, so `setLoading(true)`
    // lands and the previous child's data is already gone. No leak here.
    expect(screen.getByRole("heading").textContent).toBe("child-b");
    expect(screen.queryByTestId("body")).toBeNull();

    await act(async () => {
      second.resolve("Child B: 71% attendance");
      await second.promise;
    });
  });

  it("REPRODUCES: with a guard clause, the legacy pattern shows the previous child's data under the new child's name", async () => {
    const first = deferred<string>();
    const load = vi.fn(() => first.promise);

    const { rerender } = render(
      <LegacyPanel studentId="child-a" load={load} ready />,
    );

    await act(async () => {
      first.resolve("Child A: 92% attendance");
      await first.promise;
    });
    expect(screen.getByTestId("body").textContent).toBe("Child A: 92% attendance");

    // The parent switches child while context is momentarily unavailable —
    // exactly `if (!ready || !ctx) return;`. The effect bails before resetting,
    // so child A's attendance is now rendered under child B's name.
    rerender(<LegacyPanel studentId="child-b" load={load} ready={false} />);

    expect(screen.getByRole("heading").textContent).toBe("child-b");
    expect(screen.getByTestId("body").textContent).toBe("Child A: 92% attendance");
  });

  it("FIXED: the same guard cannot leak through useKeyedResource", async () => {
    const first = deferred<string>();
    const load = vi.fn(() => first.promise);

    const { rerender } = render(
      <KeyedPanel studentId="child-a" load={load} enabled />,
    );
    await act(async () => {
      first.resolve("Child A: 92% attendance");
      await first.promise;
    });
    expect(screen.getByTestId("body").textContent).toBe("Child A: 92% attendance");

    rerender(<KeyedPanel studentId="child-b" load={load} enabled={false} />);

    expect(screen.getByRole("heading").textContent).toBe("child-b");
    expect(screen.queryByTestId("body")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("FIXED: useKeyedResource shows a loading state instead of the previous child's data", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = vi.fn((id: string) => (id === "child-a" ? first.promise : second.promise));

    const { rerender } = render(<KeyedPanel studentId="child-a" load={load} />);

    await act(async () => {
      first.resolve("Child A: 92% attendance");
      await first.promise;
    });
    expect(screen.getByTestId("body").textContent).toBe("Child A: 92% attendance");

    rerender(<KeyedPanel studentId="child-b" load={load} />);

    // Same frame the legacy version leaked on: no body at all, just loading.
    expect(screen.getByRole("heading").textContent).toBe("child-b");
    expect(screen.queryByTestId("body")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();

    await act(async () => {
      second.resolve("Child B: 71% attendance");
      await second.promise;
    });
    expect(screen.getByTestId("body").textContent).toBe("Child B: 71% attendance");
  });

  it("ignores a slow response that belongs to a key the user already left", async () => {
    const slowA = deferred<string>();
    const fastB = deferred<string>();
    const load = (id: string) => (id === "a" ? slowA.promise : fastB.promise);

    const { rerender } = render(<KeyedPanel studentId="a" load={load} />);
    rerender(<KeyedPanel studentId="b" load={load} />);

    await act(async () => {
      fastB.resolve("B data");
      await fastB.promise;
    });
    expect(screen.getByTestId("body").textContent).toBe("B data");

    // The abandoned request for "a" now lands. It must not overwrite "b".
    await act(async () => {
      slowA.resolve("A data");
      await slowA.promise;
    });
    expect(screen.getByTestId("body").textContent).toBe("B data");
  });

  it("renders an idle state — not an endless spinner — when there is no key", () => {
    render(<KeyedPanel studentId="" load={async () => "never"} />);
    expect(screen.getByTestId("idle")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("surfaces a presentation-safe message when the loader rejects", async () => {
    const failed = deferred<string>();
    render(<KeyedPanel studentId="a" load={() => failed.promise} />);

    await act(async () => {
      failed.reject(
        Object.assign(
          new Error('new row violates row-level security policy for table "attendance"'),
          { code: "42501" },
        ),
      );
      await failed.promise.catch(() => undefined);
    });

    const error = screen.getByTestId("error").textContent ?? "";
    expect(error).not.toContain("attendance");
    expect(error).not.toContain("row-level security");
    expect(error).toContain("permission");
  });

  it("never exposes data belonging to a different key, across many switches", async () => {
    const pending = new Map<string, Deferred<string>>();
    const load = (id: string) => {
      const d = deferred<string>();
      pending.set(id, d);
      return d.promise;
    };

    const { rerender } = render(<KeyedPanel studentId="s1" load={load} />);
    for (const id of ["s2", "s3", "s4"]) {
      rerender(<KeyedPanel studentId={id} load={load} />);
      // Every switch must read as loading before anything resolves.
      expect(screen.queryByTestId("body")).toBeNull();
    }

    // Resolve every abandoned key. None may render.
    await act(async () => {
      for (const [id, d] of pending) {
        if (id !== "s4") d.resolve(`${id} data`);
      }
      await Promise.resolve();
    });
    expect(screen.queryByTestId("body")).toBeNull();

    await act(async () => {
      pending.get("s4")!.resolve("s4 data");
      await pending.get("s4")!.promise;
    });
    expect(screen.getByTestId("body").textContent).toBe("s4 data");
  });
});
