import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { SubjectChartPoint } from "@/hooks/useStudentPerformanceCharts";
import type { PracticeTrendPoint } from "@/hooks/useStudentPerformanceCharts";
import { cn } from "@/lib/utils";

type Props = {
  subjects: SubjectChartPoint[];
  practiceTrend?: PracticeTrendPoint[];
};

function SubjectRing({ accuracy, size = 56 }: { accuracy: number; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, accuracy));
  const offset = c - (pct / 100) * c;
  const color = pct >= 75 ? "#34d399" : pct >= 55 ? "#4f8cff" : "#fb7185";

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="rotate-90 origin-center"
        fill="#e8edf7"
        fontSize="11"
        fontWeight="700"
        transform={`rotate(90 ${size / 2} ${size / 2})`}
      >
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

function weeklyTrend(
  subject: string,
  practiceTrend?: PracticeTrendPoint[],
): "up" | "down" | "flat" {
  if (!practiceTrend?.length) return "flat";
  const recent = practiceTrend.slice(-3);
  if (recent.length < 2) return "flat";
  const delta = recent[recent.length - 1].score_pct - recent[0].score_pct;
  if (delta > 3) return "up";
  if (delta < -3) return "down";
  return "flat";
}

export function SubjectCardsGrid({ subjects, practiceTrend }: Props) {
  if (subjects.length === 0) {
    return (
      <p className="text-sm text-[var(--as-muted)]">No subject data yet — complete practice sessions to unlock.</p>
    );
  }

  return (
    <div className="as-subject-grid">
      {subjects.map((s) => {
        const trend = weeklyTrend(s.name, practiceTrend);
        return (
          <article key={s.name} className="as-subject-card">
            <div className="as-subject-card__name">{s.name}</div>
            <div className="as-subject-card__ring-wrap">
              <SubjectRing accuracy={s.accuracy} />
            </div>
            <div className="as-subject-card__meta">
              <span>{s.attempts} attempts</span>
              <span
                className={cn(
                  "inline-flex items-center gap-0.5",
                  trend === "up" && "as-trend-up",
                  trend === "down" && "as-trend-down",
                )}
              >
                {trend === "up" && <ArrowUp className="w-3 h-3" />}
                {trend === "down" && <ArrowDown className="w-3 h-3" />}
                {trend === "flat" && <Minus className="w-3 h-3" />}
                Weekly
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
