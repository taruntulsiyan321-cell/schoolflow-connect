import { useEffect, useState } from "react";
import type { NoteKey, QuestionFilter } from "./analyseSession";

/**
 * Owner, 2026-10-03: a result's analysis grew past one scroll, so it is filed
 * in four places — the session at a glance, where the marks went, how time
 * went, and the questions themselves. A practice session and a mock paper are
 * read through the same four (SessionTabBar draws them).
 */
export type SessionTab = "summary" | "topics" | "time" | "questions";

/** Which tab is open, which questions it shows, and the two ways the other tabs open questions. */
export function useSessionTabs() {
  const [tab, setTab] = useState<SessionTab>("summary");
  const [filter, setFilter] = useState<QuestionFilter["key"]>("all");
  const [scrollTo, setScrollTo] = useState<number | null>(null);
  useEffect(() => {
    if (tab !== "questions" || scrollTo == null) return;
    const el = document.getElementById(`question-${scrollTo + 1}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollTo(null);
  }, [tab, scrollTo]);
  /** The Questions tab, filtered to what the analysis noticed. */
  const showQuestions = (key: NoteKey) => { setFilter(key); setTab("questions"); };
  /** One question, scrolled to. */
  const showQuestion = (order: number) => { setFilter("all"); setTab("questions"); setScrollTo(order); };
  return { tab, setTab, filter, setFilter, showQuestions, showQuestion };
}
