/**
 * The teacher's question paper (§10.24) — the first screen these three tables
 * have ever had. `question_papers`, `question_paper_sections` and
 * `question_paper_questions` were created empty and no `.tsx` file referenced
 * them.
 *
 * THE BLUEPRINT COMES FIRST. A paper is a class level, a subject and a set of
 * sections, each with a format, a count, marks per question, a difficulty and
 * the chapters it draws on. Only once that exists can anything fill it.
 *
 * WHAT FILLS IT. MCQ sections pull from the 21,681-question bank, which is
 * entirely multiple choice today, so short and long sections will come up
 * short from it. Every section can also GENERATE, through ai-gateway's
 * `teacher.question_paper.generate_questions`. Where the bank falls short the
 * shortfall is printed — a paper that comes back short must look short — and
 * every question the quality guard rejected is named with its reason.
 *
 * A GENERATED QUESTION ALSO GOES BACK TO THE SHARED BANK, unapproved and
 * tagged `ai_generated`, and the screen reports that as a separate outcome
 * from the paper write. Written answers go back too since `20260916100000`
 * replaced the bank's `options`/`correct_index` NOT NULLs with the same
 * either/or answer-shape rule the paper table already had.
 *
 * THE ANSWER KEY IS A SEPARATE SHEET, on a toggle and in its own CSV, because
 * the paper is what a student sees and the key is not.
 */
import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  Download,
  FileText,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "./shared";
import {
  CurriculumService,
  QuestionBankService,
  QuestionPaperService,
  useAcademicLive,
  type QuestionPaperRow,
  type QuestionPaperSectionRow,
  type QuestionPaperQuestionRow,
  type PaperSectionFormat,
  type PaperDifficulty,
  type SectionFillResult,
  type GenerationOutcome,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { listTeacherClassSubjectPairs } from "@/academic/repository/teacherClassesRepository";
import { toRepoContext } from "@/academic/services/context";
import { answerToText } from "@/academic/services/answerText";
import { exportCSV } from "@/lib/exportCsv";
import {
  displayChapter,
  toCountLabel,
  toDisplayText,
  toEnumLabel,
  toErrorMessage,
} from "@/lib/presentation";

/**
 * WHICH CLASSES EXIST IS THE CURRICULUM TREE'S ANSWER, NOT A LITERAL HERE.
 *
 * This was `[6, 7, 8, 9, 10, 11, 12]`, copied from a CHECK constraint that
 * said the same. The curriculum runs 5 to 12 and the bank holds 2,189 usable
 * Class 5 questions, so both the constraint and this array made a Class 5
 * paper impossible — the exact defect that archived those questions the first
 * time (KNOWN_ISSUES 27). `20260916110000` replaced the constraint with a
 * curriculum lookup; this reads the same source.
 *
 * The fallback is used only until the read returns, and deliberately covers
 * the full seeded range rather than a narrower guess.
 */
const CLASS_LEVEL_FALLBACK = [5, 6, 7, 8, 9, 10, 11, 12];
const FORMATS: { value: PaperSectionFormat; label: string }[] = [
  { value: "mcq", label: "Multiple choice" },
  { value: "short", label: "Short answer" },
  { value: "long", label: "Long answer" },
];
const DIFFICULTIES: { value: PaperDifficulty | ""; label: string }[] = [
  { value: "", label: "Any difficulty" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 justify-center text-xs text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

const emptyPaperForm = () => ({
  title: "",
  subject: "",
  classLevel: "10",
  durationMinutes: "60",
});

const emptySectionForm = () => ({
  title: "",
  format: "mcq" as PaperSectionFormat,
  marksPerQuestion: "1",
  targetCount: "5",
  difficulty: "" as PaperDifficulty | "",
  chapters: "",
  topics: [] as string[],
});

type ClassSubjectPair = Awaited<ReturnType<typeof listTeacherClassSubjectPairs>>[number];

export default function QuestionPapers() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["test", "profile"]);

  const [papers, setPapers] = useState<QuestionPaperRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [paperForm, setPaperForm] = useState(emptyPaperForm);

  const [openId, setOpenId] = useState<string | null>(null);
  const [sections, setSections] = useState<QuestionPaperSectionRow[]>([]);
  const [questions, setQuestions] = useState<QuestionPaperQuestionRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sectionForm, setSectionForm] = useState(emptySectionForm);
  const [addingSection, setAddingSection] = useState(false);
  /** The canonical topics this paper's subject/class actually has questions
   *  for, with counts. Loaded from the bank rather than typed from memory —
   *  the whole reason topic was unusable before is that nobody could guess
   *  which of thirty spellings the bank stored. */
  const [topicOptions, setTopicOptions] = useState<{ topic: string; count: number }[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [fills, setFills] = useState<Record<string, SectionFillResult>>({});
  const [generated, setGenerated] = useState<Record<string, GenerationOutcome>>({});
  const [showKey, setShowKey] = useState(false);

  const [classLevels, setClassLevels] = useState<number[]>(CLASS_LEVEL_FALLBACK);
  const [pairs, setPairs] = useState<ClassSubjectPair[]>([]);
  const [pushTarget, setPushTarget] = useState("");

  const openPaper = papers.find((p) => p.id === openId) ?? null;

  const loadPapers = useCallback(async () => {
    if (!ctx) return;
    try {
      setPapers(await QuestionPaperService.list(ctx));
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e, "Could not load your question papers"));
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    if (!ready || !ctx) return;
    void loadPapers();
  }, [ready, ctx, liveVersion, loadPapers]);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    void (async () => {
      try {
        // The classes the curriculum actually has. A literal here is what made
        // Class 5 unreachable; the fallback only covers the gap before this
        // returns.
        const levels = await CurriculumService.listClassLevels(ctx);
        if (!cancelled && levels.length) setClassLevels(levels);
      } catch {
        // Keep the fallback — an empty class list would make the form unusable.
      }
      try {
        const rows = await listTeacherClassSubjectPairs(toRepoContext(ctx), ctx.userId);
        if (!cancelled) setPairs(rows);
      } catch {
        // Not fatal: the paper still builds, only the push target is missing,
        // and the push control says so rather than silently doing nothing.
        if (!cancelled) setPairs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx]);

  const loadDetail = useCallback(
    async (paperId: string) => {
      if (!ctx) return;
      setDetailLoading(true);
      try {
        const [s, q] = await Promise.all([
          QuestionPaperService.listSections(ctx, paperId),
          QuestionPaperService.listQuestions(ctx, paperId),
        ]);
        setSections(s);
        setQuestions(q);
        setError(null);
      } catch (e) {
        setError(toErrorMessage(e, "Could not load this paper"));
      } finally {
        setDetailLoading(false);
      }
    },
    [ctx],
  );

  const open = async (paperId: string) => {
    if (openId === paperId) {
      setOpenId(null);
      setSections([]);
      setQuestions([]);
      setFills({});
      setGenerated({});
      setShowKey(false);
      return;
    }
    setOpenId(paperId);
    setSections([]);
    setQuestions([]);
    setFills({});
    setGenerated({});
    setShowKey(false);
    await loadDetail(paperId);
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await fn();
      setSuccess(`${label} done`);
    } catch (e) {
      setError(toErrorMessage(e, `${label} failed`));
    } finally {
      setBusy(false);
    }
  };

  const createPaper = () =>
    run("Create paper", async () => {
      if (!ctx) return;
      const row = await QuestionPaperService.create(ctx, {
        title: paperForm.title.trim(),
        subject: paperForm.subject.trim(),
        classLevel: Number(paperForm.classLevel),
        durationMinutes: paperForm.durationMinutes ? Number(paperForm.durationMinutes) : null,
      });
      setPaperForm(emptyPaperForm());
      setCreating(false);
      await loadPapers();
      await open(row.id);
    });

  /**
   * Load the topic vocabulary whenever the section form is open and its
   * chapters change. Chapters are read from the form, so narrowing the
   * chapters narrows the topics offered — which is what makes the list short
   * enough to read.
   *
   * Failure is silent BY DESIGN: topics are a narrowing, so an empty list
   * costs the teacher nothing (the section still draws on the whole chapter
   * set). Raising an error toast here would turn an optional refinement into
   * a blocking one.
   */
  useEffect(() => {
    if (!addingSection || !ctx || !openPaper?.subject || openPaper.class_level == null) {
      setTopicOptions([]);
      return;
    }
    const chapters = sectionForm.chapters
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    let cancelled = false;
    setTopicsLoading(true);
    void QuestionBankService.listTopics(ctx, {
      subject: openPaper.subject,
      classLevel: openPaper.class_level,
      chapters,
    })
      .then((rows) => {
        if (!cancelled) setTopicOptions(rows);
      })
      .catch(() => {
        if (!cancelled) setTopicOptions([]);
      })
      .finally(() => {
        if (!cancelled) setTopicsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addingSection, ctx, openPaper?.subject, openPaper?.class_level, sectionForm.chapters]);

  const toggleTopic = (topic: string) =>
    setSectionForm((f) => ({
      ...f,
      topics: f.topics.includes(topic)
        ? f.topics.filter((t) => t !== topic)
        : [...f.topics, topic],
    }));

  const addSection = () =>
    run("Add section", async () => {
      if (!ctx || !openId) return;
      await QuestionPaperService.addSection(
        ctx,
        openId,
        {
          title: sectionForm.title.trim(),
          format: sectionForm.format,
          marksPerQuestion: Number(sectionForm.marksPerQuestion),
          targetCount: Number(sectionForm.targetCount),
          difficulty: sectionForm.difficulty || null,
          chapters: sectionForm.chapters
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          topics: sectionForm.topics,
        },
        sections.length,
      );
      setSectionForm(emptySectionForm());
      setAddingSection(false);
      await loadDetail(openId);
    });

  const generate = (section: QuestionPaperSectionRow) =>
    run("Generate", async () => {
      if (!ctx || !openId || !openPaper) return;
      const present = questions.filter((q) => q.section_id === section.id).length;
      const out = await QuestionPaperService.generateForSection(
        ctx,
        openPaper,
        section,
        present,
      );
      setGenerated((prev) => ({ ...prev, [section.id]: out }));
      await loadDetail(openId);
    });

  const fill = (section: QuestionPaperSectionRow) =>
    run("Fill from bank", async () => {
      if (!ctx || !openId || !openPaper) return;
      const result = await QuestionPaperService.fillSectionFromBank(ctx, openPaper, section);
      setFills((prev) => ({ ...prev, [section.id]: result }));
      await loadDetail(openId);
    });

  const pushAsTest = () =>
    run("Create online test", async () => {
      if (!ctx || !openId) return;
      const pair = pairs.find((p) => `${p.classId}::${p.subject}` === pushTarget);
      if (!pair) throw new Error("Choose the class and subject this test belongs to.");
      await QuestionPaperService.pushAsTestForClass(
        ctx,
        openId,
        pair.classId,
        pair.subject,
        openPaper?.duration_minutes ? openPaper.duration_minutes * 60 : null,
      );
    });

  const questionRows = (forKey: boolean) =>
    questions.map((q, i) => {
      const section = sections.find((s) => s.id === q.section_id);
      const base: Record<string, unknown> = {
        "Q#": i + 1,
        Section: section?.title ?? "",
        Question: q.question,
        Marks: q.marks ?? "",
        Chapter: q.chapter ? displayChapter(q.chapter) || q.chapter : "",
      };
      const opts = Array.isArray(q.options) ? (q.options as unknown[]) : [];
      opts.forEach((o, ix) => {
        base[`Option ${String.fromCharCode(65 + ix)}`] = o;
      });
      if (forKey) {
        base.Answer =
          q.correct_index != null
            ? (answerToText({ indexes: [q.correct_index] }, q.options) ?? "")
            : (q.answer ?? "");
        base.Explanation = q.explanation ?? "";
      }
      return base;
    });

  if (!ready || loading) return <Loading label="Loading question papers…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-foreground">Question papers</div>
          <div className="text-[10px] text-muted-foreground">
            Build the blueprint, then fill the multiple-choice sections from the question bank.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#3b5bdb]/15 text-[#3b5bdb]"
        >
          {creating ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}{" "}
          {creating ? "Cancel" : "New paper"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[#cc5069]/30 bg-[#cc5069]/10 px-3 py-2 text-xs text-[#cc5069]">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-[#4aa87a]/30 bg-[#4aa87a]/10 px-3 py-2 text-xs text-[#4aa87a]">
          {success}
        </div>
      )}

      {creating && (
        <div className="p-3 bg-surface border border-border/70 rounded-xl space-y-2">
          <input
            value={paperForm.title}
            onChange={(e) => setPaperForm({ ...paperForm, title: e.target.value })}
            placeholder="Paper title *"
            className="w-full bg-muted border border-border rounded-xl px-3 py-1.5 text-[11px] text-foreground"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              value={paperForm.subject}
              onChange={(e) => setPaperForm({ ...paperForm, subject: e.target.value })}
              placeholder="Subject *"
              className="bg-muted border border-border rounded-xl px-3 py-1.5 text-[11px] text-foreground"
            />
            <select
              value={paperForm.classLevel}
              onChange={(e) => setPaperForm({ ...paperForm, classLevel: e.target.value })}
              className="bg-muted border border-border rounded-xl px-3 py-1.5 text-[11px] text-foreground"
            >
              {classLevels.map((c) => (
                <option key={c} value={c}>
                  Class {c}
                </option>
              ))}
            </select>
            <input
              value={paperForm.durationMinutes}
              onChange={(e) => setPaperForm({ ...paperForm, durationMinutes: e.target.value })}
              placeholder="Minutes"
              className="bg-muted border border-border rounded-xl px-3 py-1.5 text-[11px] text-foreground"
            />
          </div>
          <button
            type="button"
            disabled={busy || !paperForm.title.trim() || !paperForm.subject.trim()}
            onClick={() => void createPaper()}
            className="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#3b5bdb] text-foreground disabled:opacity-50"
          >
            Create paper
          </button>
          {/* The bank is indexed by the subject NAME, so a paper whose subject
              does not match one in the bank will retrieve nothing. Saying it
              here is cheaper than a teacher wondering why a fill returned 0. */}
          <div className="text-[9px] text-muted-foreground">
            The subject must match the question bank&apos;s spelling for a section to fill
            from it.
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground">{papers.length} papers</div>

      <div className="space-y-2">
        {papers.map((p) => (
          <div key={p.id} className="p-3 bg-surface border border-border/70 rounded-xl space-y-2">
            <div className="flex justify-between gap-2">
              <button
                type="button"
                onClick={() => void open(p.id)}
                aria-expanded={openId === p.id}
                className="min-w-0 text-left"
              >
                <div className="text-xs font-bold text-foreground truncate">
                  {toDisplayText(p.title, { kind: "label", fallback: "Paper" })}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {p.subject}
                  {p.class_level != null ? ` · Class ${p.class_level}` : ""}
                  {p.duration_minutes != null ? ` · ${p.duration_minutes} min` : ""}
                </div>
              </button>
              <div className="flex items-start gap-2 shrink-0">
                <span
                  className={cn(
                    "text-[9px] font-bold px-2 py-1 rounded-lg h-fit",
                    p.status === "final"
                      ? "bg-[#4aa87a]/15 text-[#4aa87a]"
                      : "bg-muted/80 text-[#a0a0b0]",
                  )}
                >
                  {toEnumLabel(p.status, "question_paper_status")}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Delete “${p.title}”?`)) return;
                    void run("Delete paper", async () => {
                      if (!ctx) return;
                      await QuestionPaperService.remove(ctx, p.id);
                      if (openId === p.id) setOpenId(null);
                      await loadPapers();
                    });
                  }}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#cc5069]/15 text-[#cc5069] disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            {openId === p.id && (
              <div className="pt-2 border-t border-border/60 space-y-3">
                {detailLoading && <Loading label="Loading paper" />}

                {!detailLoading && (
                  <>
                    {sections.map((s) => {
                      const inSection = questions.filter((q) => q.section_id === s.id);
                      const f = fills[s.id];
                      return (
                        <div key={s.id} className="rounded-xl bg-muted/30 px-2 py-2 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[11px] font-bold text-foreground truncate">
                                {s.title}
                              </div>
                              <div className="text-[9px] text-muted-foreground">
                                {FORMATS.find((x) => x.value === s.question_format)?.label ??
                                  s.question_format}{" "}
                                · {inSection.length} of {s.target_count} ·{" "}
                                {s.marks_per_question} mark
                                {Number(s.marks_per_question) === 1 ? "" : "s"} each
                                {s.difficulty ? ` · ${s.difficulty}` : ""}
                                {s.chapters.length
                                  ? ` · ${s.chapters.map((c) => displayChapter(c) || c).join(", ")}`
                                  : ""}
                              </div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              {s.question_format === "mcq" && p.status === "draft" && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void fill(s)}
                                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#4b9fd4]/20 text-[#4b9fd4] disabled:opacity-50"
                                >
                                  Fill from bank
                                </button>
                              )}
                              {p.status === "draft" && (
                                <button
                                  type="button"
                                  disabled={busy || inSection.length >= s.target_count}
                                  onClick={() => void generate(s)}
                                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#6882e8]/20 text-[#6882e8] flex items-center gap-1 disabled:opacity-50"
                                >
                                  <Sparkles className="w-3 h-3" /> Generate
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run("Remove section", async () => {
                                    if (!ctx || !openId) return;
                                    await QuestionPaperService.removeSection(ctx, s.id);
                                    await loadDetail(openId);
                                  })
                                }
                                className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground disabled:opacity-50"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {/* The bank cannot answer for these, and no part of
                              this system generates a question. Saying so beats
                              a control that always errors. */}
                          {s.question_format !== "mcq" && (
                            <div className="text-[9px] text-muted-foreground">
                              The bank holds mostly multiple choice, so this section will
                              usually come up short — use Generate, or write it by hand.
                            </div>
                          )}

                          {generated[s.id] && (
                            <div
                              className={cn(
                                "text-[9px] rounded-lg px-2 py-1",
                                generated[s.id].degradedReason
                                  ? "bg-[#cc5069]/10 text-[#cc5069]"
                                  : "bg-[#6882e8]/10 text-[#6882e8]",
                              )}
                            >
                              {/* "Generated nothing" and "generated 3" are
                                  different facts and one of them has a reason
                                  attached. Neither is allowed to render as a
                                  blank line. */}
                              {generated[s.id].degradedReason
                                ? `Generated nothing — ${generated[s.id].degradedReason}.`
                                : `Generated ${toCountLabel(generated[s.id].inserted)}.`}
                              {generated[s.id].rejected.length > 0
                                ? ` ${generated[s.id].rejected.length} rejected by the quality check: ${generated[s.id].rejected.join("; ")}.`
                                : ""}
                              {/* The shared bank is a separate write with a
                                  separate outcome. "Saved to the paper" and
                                  "contributed to the bank" are different facts
                                  and a teacher should not have to guess which
                                  happened. */}
                              {generated[s.id].bankSaved > 0
                                ? ` ${generated[s.id].bankSaved} also sent to the question bank for review.`
                                : ""}
                              {generated[s.id].bankSkipped.length > 0
                                ? ` Not sent to the bank: ${generated[s.id].bankSkipped.join("; ")}.`
                                : ""}
                            </div>
                          )}
                          {f && (
                            <div
                              className={cn(
                                "text-[9px] rounded-lg px-2 py-1",
                                f.shortfall > 0
                                  ? "bg-[#c08a3a]/15 text-[#c08a3a]"
                                  : "bg-[#4aa87a]/10 text-[#4aa87a]",
                              )}
                            >
                              Added {toCountLabel(f.inserted)} from {toCountLabel(f.pool_size)}{" "}
                              matching in the bank
                              {f.strategy === "semantic"
                                ? `, ranked by meaning across ${f.ranked_candidates} candidates`
                                : ""}
                              .
                              {/* Why the ranking did not apply, when it did
                                  not. A structured fill dressed as a semantic
                                  one would be a claim nobody made. */}
                              {f.semantic_note
                                ? ` Ranked by chapter instead: ${f.semantic_note}.`
                                : ""}
                              {f.shortfall > 0
                                ? ` ${f.shortfall} still missing — the bank has nothing more that matches, and nothing here generates questions.`
                                : ""}
                            </div>
                          )}

                          {inSection.map((q, i) => (
                            <div
                              key={q.id}
                              className="rounded-lg bg-surface border border-border/60 px-2 py-1.5"
                            >
                              <div className="flex justify-between gap-2">
                                <div className="text-[10px] text-foreground">
                                  {i + 1}.{" "}
                                  {toDisplayText(q.question, { fallback: "Question" })}
                                </div>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void run("Remove question", async () => {
                                      if (!ctx || !openId) return;
                                      await QuestionPaperService.removeQuestion(ctx, q.id);
                                      await loadDetail(openId);
                                    })
                                  }
                                  className="text-[9px] text-muted-foreground shrink-0"
                                >
                                  remove
                                </button>
                              </div>
                              {Array.isArray(q.options) && (
                                <div className="text-[9px] text-muted-foreground mt-0.5">
                                  {(q.options as unknown[])
                                    .map(
                                      (o, ix) =>
                                        `${String.fromCharCode(65 + ix)}. ${toDisplayText(o, { fallback: "—" })}`,
                                    )
                                    .join("   ")}
                                </div>
                              )}
                              {showKey && (
                                <div className="text-[9px] text-[#4aa87a] mt-0.5">
                                  Answer:{" "}
                                  {q.correct_index != null
                                    ? (answerToText({ indexes: [q.correct_index] }, q.options) ??
                                      "not readable")
                                    : (q.answer ?? "—")}
                                </div>
                              )}
                            </div>
                          ))}
                          {inSection.length === 0 && (
                            <div className="text-[9px] text-muted-foreground">
                              Nothing in this section yet.
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {sections.length === 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        No sections yet — a paper is its blueprint first.
                      </div>
                    )}

                    {p.status === "draft" && (
                      <button
                        type="button"
                        onClick={() => setAddingSection((v) => !v)}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> {addingSection ? "Cancel" : "Add section"}
                      </button>
                    )}

                    {addingSection && (
                      <div className="rounded-xl bg-muted/30 px-2 py-2 space-y-2">
                        <input
                          value={sectionForm.title}
                          onChange={(e) =>
                            setSectionForm({ ...sectionForm, title: e.target.value })
                          }
                          placeholder="Section title *"
                          className="w-full bg-muted border border-border rounded-xl px-3 py-1.5 text-[11px] text-foreground"
                        />
                        <div className="grid grid-cols-4 gap-2">
                          <select
                            value={sectionForm.format}
                            onChange={(e) =>
                              setSectionForm({
                                ...sectionForm,
                                format: e.target.value as PaperSectionFormat,
                              })
                            }
                            className="bg-muted border border-border rounded-xl px-2 py-1.5 text-[10px] text-foreground"
                          >
                            {FORMATS.map((f) => (
                              <option key={f.value} value={f.value}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                          <input
                            value={sectionForm.targetCount}
                            onChange={(e) =>
                              setSectionForm({ ...sectionForm, targetCount: e.target.value })
                            }
                            placeholder="How many"
                            className="bg-muted border border-border rounded-xl px-2 py-1.5 text-[10px] text-foreground"
                          />
                          <input
                            value={sectionForm.marksPerQuestion}
                            onChange={(e) =>
                              setSectionForm({
                                ...sectionForm,
                                marksPerQuestion: e.target.value,
                              })
                            }
                            placeholder="Marks each"
                            className="bg-muted border border-border rounded-xl px-2 py-1.5 text-[10px] text-foreground"
                          />
                          <select
                            value={sectionForm.difficulty}
                            onChange={(e) =>
                              setSectionForm({
                                ...sectionForm,
                                difficulty: e.target.value as PaperDifficulty | "",
                              })
                            }
                            className="bg-muted border border-border rounded-xl px-2 py-1.5 text-[10px] text-foreground"
                          >
                            {DIFFICULTIES.map((d) => (
                              <option key={d.value} value={d.value}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <input
                          value={sectionForm.chapters}
                          onChange={(e) =>
                            setSectionForm({ ...sectionForm, chapters: e.target.value })
                          }
                          placeholder="Chapters, comma separated (blank = the whole subject)"
                          className="w-full bg-muted border border-border rounded-xl px-3 py-1.5 text-[11px] text-foreground"
                        />

                        {/* The topic narrowing. Chosen from what the bank
                            actually holds, never typed: the raw `topic` column
                            carries 11,917 spellings of the same ideas, so a
                            free-text box would ask the teacher to guess. The
                            count on each chip is load-bearing — the median
                            topic holds ONE question, so a topic that cannot
                            fill the section says so before it is picked. */}
                        {topicsLoading && (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" /> Loading topics…
                          </div>
                        )}
                        {!topicsLoading && topicOptions.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-[10px] text-muted-foreground">
                              Topics{" "}
                              {sectionForm.topics.length > 0
                                ? `· ${sectionForm.topics.length} chosen`
                                : "· optional, blank draws on every topic in these chapters"}
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                              {topicOptions.map((t) => {
                                const on = sectionForm.topics.includes(t.topic);
                                return (
                                  <button
                                    key={t.topic}
                                    type="button"
                                    onClick={() => toggleTopic(t.topic)}
                                    aria-pressed={on}
                                    className={cn(
                                      "px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors",
                                      on
                                        ? "bg-[#3b5bdb]/15 border-[#3b5bdb]/40 text-[#3b5bdb]"
                                        : "bg-muted border-border/70 text-muted-foreground hover:text-foreground",
                                    )}
                                  >
                                    {displayChapter(t.topic) || t.topic}
                                    <span className="ml-1 opacity-60">{t.count}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {sectionForm.topics.length > 0 && (
                              <div className="text-[10px] text-muted-foreground">
                                {(() => {
                                  const available = topicOptions
                                    .filter((t) => sectionForm.topics.includes(t.topic))
                                    .reduce((n, t) => n + t.count, 0);
                                  const want = Number(sectionForm.targetCount) || 0;
                                  return available < want
                                    ? `These topics hold ${available} question(s) — short of the ${want} this section asks for. Generation covers the rest.`
                                    : `These topics hold ${available} question(s).`;
                                })()}
                              </div>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={busy || !sectionForm.title.trim()}
                          onClick={() => void addSection()}
                          className="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#3b5bdb] text-foreground disabled:opacity-50"
                        >
                          Add section
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
                      <button
                        type="button"
                        onClick={() => setShowKey((v) => !v)}
                        className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1",
                          showKey
                            ? "bg-[#4aa87a] text-foreground"
                            : "bg-[#4aa87a]/15 text-[#4aa87a]",
                        )}
                      >
                        <BarChart3 className="w-3 h-3" />{" "}
                        {showKey ? "Hide answer key" : "Show answer key"}
                      </button>
                      <button
                        type="button"
                        disabled={questions.length === 0}
                        onClick={() => exportCSV(`paper-${p.id}`, questionRows(false))}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1 disabled:opacity-50"
                      >
                        <FileText className="w-3 h-3" /> Paper CSV
                      </button>
                      {/* A SEPARATE sheet. The paper is what a student sees. */}
                      <button
                        type="button"
                        disabled={questions.length === 0}
                        onClick={() => exportCSV(`paper-${p.id}-answer-key`, questionRows(true))}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1 disabled:opacity-50"
                      >
                        <Download className="w-3 h-3" /> Answer key CSV
                      </button>
                    </div>

                    {/* §10.24 — only an all-MCQ paper can become an online test.
                        The RPC checks it on the QUESTIONS and refuses with the
                        count, so this control stays enabled and the refusal is
                        allowed to explain itself. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={pushTarget}
                        onChange={(e) => setPushTarget(e.target.value)}
                        className="bg-muted border border-border rounded-xl px-2 py-1.5 text-[10px] text-foreground"
                      >
                        <option value="">Class and subject for the online test…</option>
                        {pairs.map((pair) => (
                          <option
                            key={`${pair.classId}::${pair.subject}`}
                            value={`${pair.classId}::${pair.subject}`}
                          >
                            {pair.className}-{pair.section} · {pair.subject}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy || !pushTarget || questions.length === 0}
                        onClick={() => void pushAsTest()}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#3b5bdb]/20 text-[#3b5bdb] flex items-center gap-1 disabled:opacity-50"
                      >
                        <Send className="w-3 h-3" /> Create online test
                      </button>
                      {pairs.length === 0 && (
                        <span className="text-[9px] text-muted-foreground">
                          No class and subject is assigned to you, so there is nowhere to put a
                          test.
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {papers.length === 0 && (
          <div className="text-xs text-muted-foreground py-6 text-center">
            No question papers yet.
          </div>
        )}
      </div>
    </div>
  );
}
