import type { ReactNode } from "react";
import { TrendingDown } from "lucide-react";
import { slippingTopics, type SyllabusMap } from "@/academic/metrics/syllabusMap";
import { MIN_OBSERVATIONS_FOR_VERDICT } from "@/academic/metrics/thresholds";
import { displayChapter, displaySubject, displayTopic } from "@/lib/academicPresentation";
import { pluralise } from "@/lib/plural";

/**
 * Topics right less often lately than before (metrics/syllabusMap.ts). Each
 * row says both figures and the window, so the claim can be checked; nothing
 * is said about topics that held or rose (§10.8).
 */
export function SlippingTopics({ map, topicLock }: { map: SyllabusMap; topicLock: ReactNode }) {
  if (map.topicsLocked) return <>{topicLock}</>;
  const slipping = slippingTopics(map);
  if (slipping.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground" data-testid="slipping-none">
        No topic has slipped in the last {pluralise(map.recentDays, "day")}. A topic is read once it has{" "}
        {MIN_OBSERVATIONS_FOR_VERDICT} answers from before and {MIN_OBSERVATIONS_FOR_VERDICT} from that time.
      </p>
    );
  }
  return (
    <ul className="space-y-2" data-testid="slipping-topics">
      {slipping.map((t) => (
        <li key={t.topicId} className="flex items-center gap-3 rounded-xl border border-warning/15 bg-warning/5 p-3" data-testid="slipping-topic">
          <TrendingDown className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">{displayTopic(t.topic) || t.topic}</div>
            <div className="text-[11px] text-muted-foreground">
              {[displayChapter(t.chapter), displaySubject(t.subject)].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-black tabular-nums text-foreground">{t.earlier.accuracy}% → {t.recent.accuracy}%</div>
            <div className="text-[10px] text-warning">down {t.drop} points in {pluralise(map.recentDays, "day")}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
