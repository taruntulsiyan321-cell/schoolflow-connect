import { useRef } from "react";

/**
 * Guards a data-loading effect against out-of-order async resolution — the
 * same job this codebase's many hand-rolled `let cancelled = false; ...
 * return () => { cancelled = true }` pairs already do (see e.g. the load
 * effects in src/gurukul/pages/Practice.tsx), packaged as one reusable
 * primitive instead of repeating the pattern by hand at every call site.
 *
 * Call the returned `beginRun()` once, synchronously, at the very start of
 * the effect body (before any `await`). It hands back `isStale()` for that
 * specific run — check it after each `await` and skip any setState once it
 * returns true, which happens as soon as a newer run of the same effect has
 * started (e.g. a dependency changed again before the first run resolved).
 *
 * Usage:
 *   const beginRun = useLatestEffect();
 *   useEffect(() => {
 *     const isStale = beginRun();
 *     (async () => {
 *       const data = await fetchThing(id);
 *       if (isStale()) return;
 *       setState(data);
 *     })();
 *   }, [id]);
 */
export function useLatestEffect(): () => () => boolean {
  const runId = useRef(0);
  const beginRun = useRef(() => {
    const thisRun = ++runId.current;
    return () => thisRun !== runId.current;
  });
  return beginRun.current;
}
