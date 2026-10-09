import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { coverage, type MapChapter, type MapTopic, subjectsOnMap, type SyllabusMap } from "@/academic/metrics/syllabusMap";
import { displayChapter, displaySubject, displayTopic } from "@/lib/academicPresentation";
import { pluralise } from "@/lib/plural";
import { cn } from "@/lib/utils";

/**
 * The whole syllabus — every chapter and topic of the student's exam — and
 * which of it they have met. COVERAGE ONLY: how many answers, or "Not
 * practised". A chapter's accuracy is said once on this tab, in "Chapter by
 * chapter"; a second figure here, counted another way, could disagree with it.
 *
 * A chapter never practised is one tap from its first session (C4): its row
 * says Start rather than Practise, and each subject names the next one to
 * start, in syllabus order.
 */
export function SyllabusCoverage({ map, topicLock }: { map: SyllabusMap; topicLock: ReactNode }) {
  const cov = coverage(map);
  const subjects = subjectsOnMap(map);
  const topicsOf = new Map<string, MapTopic[]>();
  for (const t of map.topics) topicsOf.set(t.chapterId, [...(topicsOf.get(t.chapterId) ?? []), t]);
  return (
    <div className="mt-3 space-y-5" data-testid="syllabus-coverage">
      <p className="text-sm text-muted-foreground">
        You have practised <span className="font-semibold text-foreground">{cov.practised} of {cov.chapters}</span> chapters
        in your syllabus.
      </p>
      {subjects.map((s) => (
        <section key={s.subject} aria-label={displaySubject(s.subject) || s.subject} data-testid="syllabus-subject">
          <h4 className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold text-foreground">
            {displaySubject(s.subject) || s.subject}
            <span className="text-xs font-normal text-muted-foreground">{s.practised} of {s.chapters.length} practised</span>
          </h4>
          {s.next && (
            <p className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-testid="syllabus-next">
              <span>
                Next not practised: <span className="font-semibold text-foreground">{displayChapter(s.next.chapter) || s.next.chapter}</span>
              </span>
              <Link to={practiseHref(s.next)} className="rounded-lg bg-primary px-2.5 py-1 font-semibold text-primary-foreground hover:bg-primary/90">
                Start it
              </Link>
            </p>
          )}
          <ul className="space-y-1.5">
            {s.chapters.map((c) => (
              <ChapterRow key={c.chapterId} chapter={c} topics={topicsOf.get(c.chapterId) ?? []} locked={map.topicsLocked} topicLock={topicLock} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const answersText = (answered: number) => (answered === 0 ? "Not practised" : pluralise(answered, "answer"));

/** A chapter's practice session, started by the link (Practice reads ?subject&chapter). */
const practiseHref = (c: Pick<MapChapter, "subject" | "chapter">) =>
  `/student/practice?${new URLSearchParams({ subject: c.subject, chapter: c.chapter })}`;

function ChapterRow({ chapter: c, topics, locked, topicLock }: { chapter: MapChapter; topics: MapTopic[]; locked: boolean; topicLock: ReactNode }) {
  const [open, setOpen] = useState(false);
  const metTopics = topics.filter((t) => t.answered > 0).length;
  return (
    <li className="rounded-xl border border-border/70 bg-surface/60" data-testid="syllabus-chapter">
      <div className="flex items-center gap-2 p-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            aria-hidden
            className={cn("h-2 w-2 shrink-0 rounded-full", c.answered === 0 ? "border border-muted-foreground/60" : "bg-primary")}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">{displayChapter(c.chapter) || c.chapter}</span>
            <span className={cn("block text-[11px]", c.answered === 0 ? "text-muted-foreground" : "text-foreground/80")}>
              {answersText(c.answered)}
              {!locked && topics.length > 0 ? ` · ${metTopics} of ${pluralise(topics.length, "topic")} met` : ""}
            </span>
          </span>
          <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {c.answered === 0 ? (
          <Link to={practiseHref(c)} className="shrink-0 rounded-lg bg-primary/15 px-2 py-1.5 text-xs font-semibold text-foreground hover:bg-primary/25">
            Start
          </Link>
        ) : (
          <Link to={practiseHref(c)} className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10">
            Practise
          </Link>
        )}
      </div>
      {open && (
        <div className="border-t border-border/60 px-3 py-2.5">
          {locked ? (
            topicLock
          ) : topics.length === 0 ? (
            <p className="text-xs text-muted-foreground">This chapter has no topics listed yet.</p>
          ) : (
            <ul className="space-y-1">
              {topics.map((t) => (
                <li key={t.topicId} className="flex items-baseline justify-between gap-3 text-xs" data-testid="syllabus-topic">
                  <span className="min-w-0 text-foreground">{displayTopic(t.topic) || t.topic}</span>
                  <span className={cn("shrink-0 tabular-nums", t.answered === 0 ? "text-muted-foreground" : "text-foreground/80")}>
                    {answersText(t.answered)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
