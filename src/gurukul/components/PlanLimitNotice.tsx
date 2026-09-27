import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { canBuyInThisApp, type PlanLimit } from "@/lib/premium";
import { cn } from "./shared";

/** When a counted allowance comes back. */
function resetsWhen(limit: PlanLimit): string | null {
  if (limit.reason !== "limit_reached") return null;
  if (limit.decision.period === "day") return "It resets at midnight.";
  if (limit.decision.period === "month") return "It resets on the 1st of next month.";
  return null;
}

/**
 * THE panel's answer when a plan refuses something — every gate shows this,
 * so a refusal reads the same wherever it happens.
 *
 * In the Android app it names no price and offers no way to buy (Google Play
 * billing rules): it says what the plan does not cover, and when a daily or
 * monthly allowance comes back.
 */
export function PlanLimitNotice({ limit, className }: { limit: PlanLimit; className?: string }) {
  const navigate = useNavigate();
  const buy = canBuyInThisApp();
  const resets = resetsWhen(limit);

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3",
        className,
      )}
    >
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{limit.message}</p>
        {(resets || buy) && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[resets, buy ? "See which plan gives you more." : null].filter(Boolean).join(" ")}
          </p>
        )}
      </div>
      {buy && (
        <button
          type="button"
          onClick={() => navigate("/student/premium")}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          See plans
        </button>
      )}
    </div>
  );
}
