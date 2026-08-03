import { useCallback, useRef } from "react";

/**
 * Gate full-screen / spinner loading to the genuine first fetch.
 * AcademicLive bumps, focus/poll refreshes, and silent refetches must update
 * data in place — never wipe an already-rendered surface back to loading.
 */
export function useInitialLoadGate() {
  const loadedRef = useRef(false);

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
