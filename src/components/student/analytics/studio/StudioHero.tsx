import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { Trophy } from "lucide-react";
import type { SubjectChartPoint } from "@/hooks/useStudentPerformanceCharts";

type Props = {
  firstName: string;
  studentClass: string | null;
  classRank: number | null;
  classSize: number;
  accuracy: number;
  attendance: number;
  level: number;
  xp: number;
  examReadiness: number;
  subjects: SubjectChartPoint[];
};

function ReadinessRing({ score }: { score: number }) {
  const size = 88;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, score) / 100) * c;
  return (
    <div className="as-readiness-ring">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#asReadinessGrad)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="asReadinessGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4f8cff" />
            <stop offset="100%" stopColor="#38d9f5" />
          </linearGradient>
        </defs>
      </svg>
      <div className="as-readiness-ring__label">
        <span>Exam ready</span>
        <span className="as-readiness-ring__value">{score}%</span>
      </div>
    </div>
  );
}

export function StudioHero({
  firstName,
  studentClass,
  classRank,
  classSize,
  accuracy,
  attendance,
  level,
  xp,
  examReadiness,
  subjects,
}: Props) {
  const xpInLevel = xp % 100;
  const radarData = subjects.length > 0
    ? subjects.map((s) => ({ subject: s.name.slice(0, 8), accuracy: Math.round(s.accuracy) }))
    : [{ subject: "Practice", accuracy: accuracy }];

  return (
    <section className="as-hero">
      <p className="as-hero__eyebrow">Deep Analysis</p>
      <div className="as-hero__title-row">
        <div>
          {classRank != null && (
            <span className="as-rank-badge">
              <Trophy className="w-3 h-3" />
              Rank #{classRank}
              {classSize > 0 ? ` of ${classSize}` : ""}
            </span>
          )}
          <h1 className="as-hero__name">Hi, {firstName}</h1>
          {studentClass && <p className="as-hero__class">{studentClass}</p>}
        </div>
      </div>

      <div className="as-mini-stats">
        <div className="as-mini-stat">
          <div className="as-mini-stat__label">Accuracy</div>
          <div className="as-mini-stat__value">{accuracy}%</div>
        </div>
        <div className="as-mini-stat">
          <div className="as-mini-stat__label">Attendance</div>
          <div className="as-mini-stat__value">{attendance}%</div>
        </div>
        <div className="as-mini-stat">
          <div className="as-mini-stat__label">Level</div>
          <div className="as-mini-stat__value">L{level}</div>
        </div>
      </div>

      <div className="as-xp-bar">
        <div className="as-xp-bar__track">
          <div className="as-xp-bar__fill" style={{ width: `${xpInLevel}%` }} />
        </div>
        <div className="as-xp-bar__meta">
          <span>Level {level} progress</span>
          <span>{xpInLevel}/100 XP to next level</span>
        </div>
      </div>

      <div className="as-hero__charts">
        <ReadinessRing score={examReadiness} />
        <div className="h-[140px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="rgba(255,255,255,0.1)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: "#8b9bb8", fontSize: 10 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                name="Accuracy"
                dataKey="accuracy"
                stroke="#4f8cff"
                fill="#4f8cff"
                fillOpacity={0.25}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
