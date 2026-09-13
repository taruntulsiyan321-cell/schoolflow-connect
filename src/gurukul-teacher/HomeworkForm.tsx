import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Save, Send } from "lucide-react";
import {
  CurriculumService,
  HOMEWORK_QUESTION_FILE_PICKER,
  HomeworkService,
  WORK_KINDS,
  WORK_KIND_LABELS,
  type CurriculumChapter,
  type CurriculumTopic,
  type WorkKind,
} from "@/academic";
import type { HomeworkInput, HomeworkPriority, HomeworkRecord } from "@/academic/repository/homeworkRepository";
import type { AcademicFile } from "@/academic/storage/academicFileUpload";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { enumOptions, toErrorMessage } from "@/lib/presentation";
import { OneFileField } from "./AttachmentUI";

type PublishMode = "now" | "schedule" | "draft";
type QuestionMode = "text" | "file";

/** Editing homework that has not closed, or setting new homework from an existing one. */
export type HomeworkFormSource = { as: "edit" | "copy"; homework: HomeworkRecord };

const NO_CHAPTER = "__none__";
const ADD_TOPIC = "__add__";

/** `datetime-local` holds a wall-clock time with no zone; the browser's zone is the teacher's. */
function toInstant(local: string): string {
  return new Date(local).toISOString();
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MODE_OF_STATUS: Record<HomeworkRecord["status"], PublishMode> = {
  published: "now",
  scheduled: "schedule",
  draft: "draft",
  archived: "draft",
};

const field = "w-full bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground";

/**
 * Set or edit homework (docs/gurukul-spec-rules.md, "Homework — RULED 2026-09-13").
 *
 * A title and the usual fields; the question as typed text OR one file; a
 * deadline; out now, on a schedule, or kept as a draft. The class is the one
 * the teacher opened. §10.22: the chapter is picked from the class's curriculum,
 * never typed; the topic is picked from that chapter or added; a free-text label
 * is allowed only where no chapter fits.
 *
 * A copy starts with no deadline: the one it came from has usually passed, and
 * the database refuses to release work whose deadline has.
 */
export function HomeworkForm({
  classId,
  classLabel,
  subject,
  source,
  onSaved,
  onCancel,
}: {
  classId: string;
  classLabel: string;
  subject: string;
  source?: HomeworkFormSource;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { ctx } = useAcademicContext();
  const from = source?.homework;
  const editing = source?.as === "edit" ? source.homework : null;
  const [title, setTitle] = useState(from ? (editing ? from.title : `${from.title} (copy)`) : "");
  const [workKind, setWorkKind] = useState<WorkKind>(from?.workKind ?? "homework");
  const [priority, setPriority] = useState<HomeworkPriority>(from?.priority ?? "normal");
  const [questionMode, setQuestionMode] = useState<QuestionMode>(from?.questionFile ? "file" : "text");
  const [questionText, setQuestionText] = useState(from?.questionText ?? "");
  const [questionFile, setQuestionFile] = useState<AcademicFile | null>(from?.questionFile ?? null);
  const [chapters, setChapters] = useState<CurriculumChapter[]>([]);
  const [chapterChoice, setChapterChoice] = useState(from?.chapterId ?? (from?.chapterLabel ? NO_CHAPTER : ""));
  const [chapterLabel, setChapterLabel] = useState(from?.chapterLabel ?? "");
  const [topics, setTopics] = useState<CurriculumTopic[]>([]);
  const [topicChoice, setTopicChoice] = useState(from?.topicId ?? "");
  const [newTopic, setNewTopic] = useState("");
  const [closesAt, setClosesAt] = useState(editing ? toLocalInput(editing.closesAt) : "");
  const [publishMode, setPublishMode] = useState<PublishMode>(editing ? MODE_OF_STATUS[editing.status] : "now");
  const [scheduledAt, setScheduledAt] = useState(editing ? toLocalInput(editing.scheduledPublishAt) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Published homework is already with the class; editing it changes its content, not its release. */
  const released = editing?.status === "published";

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    CurriculumService.listChaptersForClass(ctx, classLabel, subject)
      .then((rows) => {
        if (cancelled) return;
        setChapters(rows);
        // With nothing to pick from, the free-text label is the only way in.
        if (rows.length === 0) setChapterChoice(NO_CHAPTER);
      })
      .catch((e) => !cancelled && setError(toErrorMessage(e, "Failed to load chapters")));
    return () => {
      cancelled = true;
    };
  }, [ctx, classLabel, subject]);

  const chapterId = chapterChoice && chapterChoice !== NO_CHAPTER ? chapterChoice : null;

  useEffect(() => {
    setTopics([]);
    if (!ctx || !chapterId) return;
    let cancelled = false;
    CurriculumService.listTopics(ctx, chapterId)
      .then((rows) => !cancelled && setTopics(rows))
      .catch((e) => !cancelled && setError(toErrorMessage(e, "Failed to load topics")));
    return () => {
      cancelled = true;
    };
  }, [ctx, chapterId]);

  const pickChapter = (value: string) => {
    setChapterChoice(value);
    setTopicChoice("");
    setNewTopic("");
  };

  const save = async () => {
    if (!ctx || saving) return;
    const problems = [
      !title.trim() && "Give the homework a title.",
      !closesAt && "Set the deadline.",
      publishMode !== "draft" &&
        (questionMode === "text" ? !questionText.trim() : !questionFile) &&
        "Give the question — typed, or as one file.",
      publishMode === "schedule" && !scheduledAt && "Choose when it goes out.",
      topicChoice === ADD_TOPIC && !newTopic.trim() && "Name the topic to add, or pick one.",
    ].filter(Boolean);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let topicId = topicChoice && topicChoice !== ADD_TOPIC ? topicChoice : null;
      if (chapterId && topicChoice === ADD_TOPIC) {
        topicId = (await CurriculumService.addTopic(ctx, chapterId, newTopic)).id;
      }
      const input: HomeworkInput = {
        classId,
        subject,
        title,
        questionText: questionMode === "text" ? questionText : "",
        questionFile: questionMode === "file" ? questionFile : null,
        chapterId,
        topicId,
        chapterLabel: chapterId ? null : chapterLabel,
        closesAt: toInstant(closesAt),
        priority,
        workKind,
        status: publishMode === "now" ? "published" : publishMode === "schedule" ? "scheduled" : "draft",
        scheduledPublishAt: publishMode === "schedule" ? toInstant(scheduledAt) : null,
      };
      if (editing) await HomeworkService.update(ctx, editing.id, input);
      else await HomeworkService.create(ctx, input);
      onSaved();
    } catch (e) {
      setError(toErrorMessage(e, editing ? "Failed to save the homework" : "Failed to set homework"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-[2px] p-4 space-y-3">
      <div className="text-[10px] text-muted-foreground">
        {editing ? "Editing" : source?.as === "copy" ? "New homework from a copy" : "New homework"} · For {classLabel} ·{" "}
        {subject}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title *" className={field} />

      <div className="flex flex-wrap gap-2">
        <select value={workKind} onChange={(e) => setWorkKind(e.target.value as WorkKind)} className={field + " w-auto"}>
          {WORK_KINDS.map((k) => (
            <option key={k} value={k}>
              {WORK_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as HomeworkPriority)}
          className={field + " w-auto"}
        >
          {enumOptions("homework_priority").map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex gap-1">
          {(
            [
              { key: "text", label: "Type the question" },
              { key: "file", label: "Upload the question" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setQuestionMode(m.key)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                questionMode === m.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {questionMode === "text" ? (
          <textarea
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            placeholder="The question"
            className={field + " min-h-[70px]"}
          />
        ) : (
          <OneFileField
            value={questionFile}
            onChange={setQuestionFile}
            accept={HOMEWORK_QUESTION_FILE_PICKER.accept}
            kinds={HOMEWORK_QUESTION_FILE_PICKER.kinds}
            kindsLabel={HOMEWORK_QUESTION_FILE_PICKER.label}
            disabled={saving}
          />
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <select value={chapterChoice} onChange={(e) => pickChapter(e.target.value)} className={field}>
          <option value="">Chapter (optional)</option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NO_CHAPTER}>No chapter fits — write a label</option>
        </select>
        {chapterChoice === NO_CHAPTER && (
          <input
            value={chapterLabel}
            onChange={(e) => setChapterLabel(e.target.value)}
            placeholder="Label (optional)"
            className={field}
          />
        )}
        {chapterId && (
          <select value={topicChoice} onChange={(e) => setTopicChoice(e.target.value)} className={field}>
            <option value="">Topic (optional)</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value={ADD_TOPIC}>Add a topic…</option>
          </select>
        )}
        {chapterId && topicChoice === ADD_TOPIC && (
          <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="New topic" className={field} />
        )}
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] font-semibold text-muted-foreground">Deadline *</span>
        <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className={field} />
      </label>

      {!released && (
        <div className="flex flex-wrap gap-1">
          {(
            [
              { key: "now", label: "Publish now" },
              { key: "schedule", label: "Schedule" },
              { key: "draft", label: "Save draft" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setPublishMode(m.key)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                publishMode === m.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      {publishMode === "schedule" && (
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold text-muted-foreground">Goes out at *</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className={field}
          />
        </label>
      )}

      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-bold text-primary-foreground bg-primary disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : publishMode === "schedule" ? (
            <CalendarClock className="w-3.5 h-3.5" />
          ) : publishMode === "draft" || released ? (
            <Save className="w-3.5 h-3.5" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          {released
            ? "Save changes"
            : publishMode === "now"
              ? "Publish"
              : publishMode === "schedule"
                ? "Schedule"
                : "Save draft"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-2 text-xs font-bold text-muted-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}
