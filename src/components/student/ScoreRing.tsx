export function ScoreRing({ value, max, size = 120, label }: { value: number; max: number; size?: number; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--muted))" strokeWidth={8} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--primary))" strokeWidth={8} fill="none"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold">{Math.round(value)}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label ?? `of ${max}`}</div>
      </div>
    </div>
  );
}
