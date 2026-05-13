import { getBadge, TIER_CLASS } from "@/lib/badges";
import { cn } from "@/lib/utils";

export function EquippedBadge({ code, size = "sm", showLabel = false }: { code?: string | null; size?: "xs" | "sm" | "md"; showLabel?: boolean }) {
  const b = getBadge(code);
  if (!b) return null;
  const Icon = b.icon;
  const t = TIER_CLASS[b.tier];
  const px = size === "xs" ? "w-5 h-5" : size === "md" ? "w-9 h-9" : "w-7 h-7";
  const ip = size === "xs" ? "w-3 h-3" : size === "md" ? "w-5 h-5" : "w-4 h-4";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span title={`${b.label} · ${b.desc}`} className={cn("rounded-full text-white flex items-center justify-center ring-2", px, t.bg, t.ring)}>
        <Icon className={ip} />
      </span>
      {showLabel && <span className={cn("text-xs font-semibold", t.text)}>{b.label}</span>}
    </span>
  );
}
