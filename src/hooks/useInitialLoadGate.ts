import { useCallback, useRef } from "react";

/**
 * Gate full-screen / spinner loading to the genuine first fetch.
 * AcademicLive bumps, focus/poll refreshes, and silent refetches must update
 * data in place — never wipe an already-rendered surface back to loading.
 *
 * IDENTITY AWARENESS (added 2026-08-24)
 * -------------------------------------
 * "Keep the current data on screen while refetching" is right for a refresh of
 * the SAME subject, and wrong the moment the subject itself changes. Without a
 * key this hook could not tell the two apart, so switching child / class /
 * student re-ran the loader with the spinner suppressed — leaving the previous
 * subject's data rendered under the new subject's heading until the fetch
 * returned. That is the same defect `useKeyedResource` exists to prevent, in a
 * hook already shared by 9 screens.
 *
 * Pass the identity the data belongs to and the gate resets when it changes:
 *
 *     const gate = useInitialLoadGate([studentId, classId]);
 *
 * A `liveVersion` bump is deliberately NOT part of the key — that is a refresh
 * of the same subject, which should still update in place.
 *
 * Called with no key it behaves exactly as before, so existing callers are
 * unaffected until they opt in.
 */
export type LoadGateKeyPart = string | number | boolean | null | undefined;

function serializeKey(key: LoadGateKeyPart | readonly LoadGateKeyPart[]): string {
  if (Array.isArray(key)) return key.map((p) => String(p ?? "")).join("␟");
  return String((key as LoadGateKeyPart) ?? "");
}

/**
 * Reset a hand-rolled "have I loaded once" ref when the identity it belongs to
 * changes — during render, not in an effect.
 *
 * Several panels wrote this instead:
 *
 *     useEffect(() => { loadedRef.current = false; }, [classId]);
 *
 * An effect runs *after* the commit that already has the new `classId`, so for
 * that commit the ref still says "loaded" and the previous class's rows are on
 * screen under the new class's heading. Comparing during render closes the gap.
 *
 * Prefer `useInitialLoadGate(key)` for new code; this exists so the existing
 * hand-rolled refs can be corrected without restructuring each screen.
 */
export function useResetOnIdentityChange(
  ref: { current: boolean },
  key: LoadGateKeyPart | readonly LoadGateKeyPart[],
): void {
  const keyRef = useRef<string | null>(null);
  const serialized = serializeKey(key);
  if (keyRef.current !== serialized) {
    keyRef.current = serialized;
    ref.current = false;
  }
}

export function useInitialLoadGate(
  key?: LoadGateKeyPart | readonly LoadGateKeyPart[],
) {
  const loadedRef = useRef(false);
  const keyRef = useRef<string | null>(null);

  // Compared during render so the reset is visible to the very first
  // `showLoading` call after a switch — an effect would run too late.
  if (key !== undefined) {
    const serialized = serializeKey(key);
    if (keyRef.current !== serialized) {
      keyRef.current = serialized;
      loadedRef.current = false;
    }
  }

  const beginLoading = useCallback((setLoading: (value: boolean) => void) => {
    if (!loadedRef.current) setLoading(true);
  }, []);

  const endLoading = useCallback((setLoading: (value: boolean) => void) => {
    loadedRef.current = true;
    setLoading(false);
  }, []);

  const showLoading = useCallback((loading: boolean) => loading && !loadedRef.current, []);

  return { loadedRef, beginLoading, endLoading, showLoading };
}
