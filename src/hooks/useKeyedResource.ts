import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "@/lib/presentation";

/**
 * Loading primitive that cannot show one subject's data under another's heading.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app hand-rolls ~70 loaders shaped like this:
 *
 *     const [rows, setRows] = useState([]);
 *     const [loading, setLoading] = useState(true);
 *     useEffect(() => {
 *       (async () => { setLoading(true); setRows(await load(studentId)); })();
 *     }, [studentId]);
 *
 * On an ordinary click-driven switch this is SAFE: React flushes the passive
 * effect (and so `setLoading(true)`) before the browser paints, so the user
 * sees a spinner rather than the previous child's data. The audit found no
 * live instance of a visible stale frame, and that behaviour is pinned by a
 * test in `useKeyedResource.test.tsx` so it cannot silently regress.
 *
 * The pattern IS unsafe once a guard clause is added — which nearly every
 * panel here has:
 *
 *     useEffect(() => {
 *       if (!ready || !ctx) return;   // returns before resetting anything
 *       ...
 *     }, [ready, ctx, studentId]);
 *
 * When the key changes while the guard is false, no state is reset and the
 * previous subject's data stays on screen under the new subject's heading.
 * That leak is reproduced in the test file.
 *
 * THE FIX
 * -------
 * State is stamped with the key it was loaded for, and the hook refuses to
 * return state whose stamp does not match the key being rendered right now.
 * A key change therefore reads as `loading` on the very first render whatever
 * the guards do — no timers, no artificial delay.
 */

/** Values that identify what is being loaded. */
export type ResourceKeyPart = string | number | boolean | null | undefined;
export type ResourceKey = ResourceKeyPart | readonly ResourceKeyPart[];

export type ResourceStatus = "idle" | "loading" | "ready" | "error";

export interface ResourceState<T> {
  status: ResourceStatus;
  /** Only ever non-null when `status === "ready"`. */
  data: T | null;
  /** Presentation-safe message; never raw database text. */
  error: string | null;
  /** Convenience flags. */
  isLoading: boolean;
  isReady: boolean;
  /** No key to load for — render an empty state, not a spinner. */
  isIdle: boolean;
}

export interface KeyedResourceResult<T> extends ResourceState<T> {
  /** Re-run the loader for the current key. */
  refresh: () => void;
}

export interface KeyedResourceOptions {
  /** Message used when the loader throws something unrecognised. */
  errorFallback?: string;
  /**
   * Skip loading even though a key is present (e.g. auth not settled yet).
   * The hook reports `loading` while disabled-but-keyed, never `ready`.
   */
  enabled?: boolean;
}

/** Serialize a key so equality is structural, not referential. */
function serializeKey(key: ResourceKey): string | null {
  if (Array.isArray(key)) {
    if (key.some((part) => part == null || part === "")) return null;
    return key.map((part) => String(part)).join("␟");
  }
  if (key == null || key === "") return null;
  return String(key);
}

interface InternalState<T> {
  /** The serialized key this state belongs to. */
  key: string | null;
  status: ResourceStatus;
  data: T | null;
  error: string | null;
}

function idleState<T>(): InternalState<T> {
  return { key: null, status: "idle", data: null, error: null };
}

/**
 * Load a value for a key, guaranteeing the returned state always belongs to
 * the key passed in this render.
 *
 * ```tsx
 * const attendance = useKeyedResource(
 *   studentId,
 *   (id, signal) => AttendanceService.listForStudent(ctx, id, { signal }),
 *   { errorFallback: "Couldn't load attendance." },
 * );
 *
 * if (attendance.isIdle) return <SelectAChildPrompt />;
 * if (attendance.isLoading) return <Skeleton />;
 * if (attendance.error) return <ErrorNote message={attendance.error} />;
 * return <AttendanceList rows={attendance.data ?? []} />;
 * ```
 */
export function useKeyedResource<T>(
  key: ResourceKey,
  loader: (key: string, signal: AbortSignal) => Promise<T>,
  options: KeyedResourceOptions = {},
): KeyedResourceResult<T> {
  const { errorFallback = "Couldn't load this right now.", enabled = true } = options;

  const serialized = useMemo(() => serializeKey(key), [key]);
  const [state, setState] = useState<InternalState<T>>(idleState<T>);
  const [nonce, setNonce] = useState(0);

  // The loader is usually an inline closure; keep the latest without making it
  // an effect dependency (which would re-fetch on every parent render).
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (serialized == null) {
      setState(idleState<T>());
      return;
    }
    if (!enabled) return;

    const controller = new AbortController();
    let cancelled = false;

    setState({ key: serialized, status: "loading", data: null, error: null });

    (async () => {
      try {
        const data = await loaderRef.current(serialized, controller.signal);
        if (cancelled || controller.signal.aborted) return;
        setState({ key: serialized, status: "ready", data, error: null });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          key: serialized,
          status: "error",
          data: null,
          error: toErrorMessage(err, errorFallback),
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [serialized, enabled, nonce, errorFallback]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return useMemo<KeyedResourceResult<T>>(() => {
    // No key: there is nothing to show and nothing to wait for.
    if (serialized == null) {
      return {
        status: "idle",
        data: null,
        error: null,
        isLoading: false,
        isReady: false,
        isIdle: true,
        refresh,
      };
    }

    // THE GUARD. State stamped with a different key belongs to a different
    // subject and must never be rendered under this one. This is what removes
    // the stale frame — it is a render-time check, not an effect.
    const matches = state.key === serialized;
    if (!matches || !enabled || state.status === "loading") {
      return {
        status: "loading",
        data: null,
        error: null,
        isLoading: true,
        isReady: false,
        isIdle: false,
        refresh,
      };
    }

    return {
      status: state.status,
      data: state.status === "ready" ? state.data : null,
      error: state.status === "error" ? state.error : null,
      isLoading: false,
      isReady: state.status === "ready",
      isIdle: false,
      refresh,
    };
  }, [serialized, state, enabled, refresh]);
}
