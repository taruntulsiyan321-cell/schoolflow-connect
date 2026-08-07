import type { RiskBand } from "./riskProducts";

/**
 * Shared presentational layer for EIE risk products. Pure display — all
 * scoring happens in riskProducts.ts / the server-persisted band columns.
 */

const BAND_STYLE: Record<RiskBand, { bg: string; fg: string; label: string }> = {
  low: { bg: "rgba(16,185,129,0.14)", fg: "#10b981", label: "Healthy" },
  moderate: { bg: "rgba(245,158,11,0.14)", fg: "#f59e0b", label: "Watch" },
  elevated: { bg: "rgba(249,115,22,0.16)", fg: "#f97316", label: "Elevated risk" },
  high: { bg: "rgba(220,38,38,0.16)", fg: "#dc2626", label: "High risk" },
  unknown: { bg: "rgba(120,120,140,0.14)", fg: "#78788c", label: "No data" },
};

const REASON_COPY: Record<string, string> = {
  attendance_critical_threshold: "Attendance has dropped below 75%.",
  attendance_watch_threshold: "Attendance is between 75% and 85%.",
  attendance_soft_gap: "Attendance is slightly below the 95% target.",
  attendance_healthy: "Attendance is at or above 95%.",
  attendance_data_missing: "Not enough attendance data yet.",
  homework_critical: "Fewer than half of assigned homework is being completed.",
  homework_inconsistent: "Homework completion is inconsistent (50-70%).",
  homework_developing: "Homework completion is developing (70-85%).",
  homework_consistent: "Homework completion is consistent (85%+).",
  homework_data_missing: "Not enough homework data yet.",
};

export function riskReasonText(reasonCodes: string[]): string | null {
  const code = reasonCodes[0];
  if (!code) return null;
  return REASON_COPY[code] ?? null;
}

export function RiskBadge({
  band,
  size = "md",
}: {
  band: RiskBand;
  size?: "sm" | "md";
}) {
  const s = BAND_STYLE[band] ?? BAND_STYLE.unknown;
  const pad = size === "sm" ? "2px 8px" : "4px 10px";
  const font = size === "sm" ? 9 : 10;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: pad,
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        fontSize: font,
        fontWeight: 800,
        letterSpacing: 0.3,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}
