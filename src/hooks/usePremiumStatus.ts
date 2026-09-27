import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPremiumStatus, type PremiumStatus } from "@/lib/premium";
import { toErrorMessage } from "@/lib/presentation";

const CHANGED = "gurukul:premium-changed";

/**
 * Tell every mounted usePremiumStatus to read again — after a purchase, or
 * after a door refused something (the counts moved).
 */
export function premiumChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * The caller's plan, allowances and what can be bought (rpc_my_premium).
 * `status.individual === false` for a school's student: plans do not apply.
 */
export function usePremiumStatus(enabled = true) {
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  // Only the latest read may land: an older one finishing last must not
  // overwrite a newer answer.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const s = await fetchPremiumStatus();
      if (mine !== seq.current) return;
      setStatus(s);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(toErrorMessage(e, "Could not load your plan"));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const onChanged = () => void load();
    window.addEventListener(CHANGED, onChanged);
    return () => window.removeEventListener(CHANGED, onChanged);
  }, [enabled, load]);

  return { status, loading, error, reload: load };
}
