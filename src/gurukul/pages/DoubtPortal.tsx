import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  DoubtService,
  useAcademicLive,
  uploadDoubtAttachment,
  signedDoubtUrl,
  DOUBT_FILE_ACCEPT,
  type DoubtRow,
  type DoubtAnswerRow,
  type DoubtAttachmentRow,
  type DoubtUploadMeta,
  type DoubtStatus,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { GlassCard, SubjectBadge, cn, subjectColor } from "@/gurukul/components/shared";
import { getNcertChapters, parseClassGrade } from "@/lib/ncertSyllabus";
import {
  COMING_SOON_LABEL,
  comingSoonToast,
  listDoubtAttachControls,
  type DoubtAttachKind,
} from "@/lib/productFeatureFlags";
import { toast } from "sonner";
import {
  MessageCircle,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  ChevronRight,
  Send,
  Paperclip,
  X,
  Loader2,
  AlertCircle,
  Filter,
  Image,
  Camera,
  FileText,
  Mic,
} from "lucide-react";
import { toErrorMessage } from "@/lib/presentation";

const DOUBT_ATTACH_ICONS: Record<DoubtAttachKind, ReactNode> = {
  image: <Image className="w-3.5 h-3.5" />,
  camera: <Camera className="w-3.5 h-3.5" />,
  pdf: <FileText className="w-3.5 h-3.5" />,
  voice: <Mic className="w-3.5 h-3.5" />,
};

const DOUBT_ATTACH_ACCEPT: Record<DoubtAttachKind, string> = {
  image: "image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp",
  camera: "image/*",
  pdf: "application/pdf,.pdf",
  voice: "audio/*",
};

function notifyDoubtAttachComingSoon(label: string) {
  toast.message(comingSoonToast(label));
}

type View = "feed" | "ask" | "detail";
type ScopeFilter = "all" | "mine";
type StatusFilter = "all" | DoubtStatus;

type FeedItem = DoubtRow & {
  status: DoubtStatus;
  attachmentCount: number;
};

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }),
    full: d.toLocaleString("en-IN"),
  };
}

function StatusChip({ status }: { status: DoubtStatus }) {
  if (status === "open") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-400">
        <Clock className="w-2.5 h-2.5" /> Open
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-400">
      <CheckCircle2 className="w-2.5 h-2.5" /> Solved
    </span>
  );
}

function AttachmentList({ rows }: { rows: DoubtAttachmentRow[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const row of rows) {
        const url = await signedDoubtUrl(row.storage_path);
        if (url) next[row.id] = url;
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  if (!rows.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((a) => {
        const href = urls[a.id];
        const isImage = (a.file_type ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.file_name);
        return (
          <a
            key={a.id}
            href={href ?? undefined}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-2 rounded-xl border border-black/10 bg-black/4 px-2.5 py-2 text-[11px] text-muted-foreground hover:border-black/20 transition-all",
              !href && "opacity-60 pointer-events-none",
            )}
          >
            {isImage && href ? (
              <img src={href} alt={a.file_name} className="w-10 h-10 rounded-lg object-cover" />
            ) : (
              <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            <span className="max-w-[140px] truncate">{a.file_name}</span>
          </a>
        );
      })}
    </div>
  );
}

function FileChips({
  files,
  onRemove,
}: {
  files: { name: string; meta?: DoubtUploadMeta }[];
  onRemove: (idx: number) => void;
}) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <span
          key={`${f.name}-${i}`}
          className="inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg bg-black/5 border border-black/10 text-muted-foreground"
        >
          <Paperclip className="w-3 h-3" />
          <span className="max-w-[120px] truncate">{f.name}</span>
          <button type="button" onClick={() => onRemove(i)} className="hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

export default function DoubtPortal() {
  const { ctx, ready, classId, classLabel } = useAcademicContext();
  const liveVersion = useAcademicLive(["doubt", "profile"]);
  const askFileRef = useRef<HTMLInputElement>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);
  const feedLoadedRef = useRef(false);
  const [askAccept, setAskAccept] = useState(DOUBT_FILE_ACCEPT);
  const [replyAccept, setReplyAccept] = useState(DOUBT_FILE_ACCEPT);

  const [view, setView] = useState<View>("feed");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");

  const [subjects, setSubjects] = useState<{ subject: string; subjectId: string | null }[]>([]);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Ask form
  const [askSubject, setAskSubject] = useState("");
  const [askSubjectId, setAskSubjectId] = useState<string | null>(null);
  const [askChapter, setAskChapter] = useState("");
  const [askBody, setAskBody] = useState("");
  const [askFiles, setAskFiles] = useState<File[]>([]);
  const [asking, setAsking] = useState(false);

  // Detail
  const [detail, setDetail] = useState<FeedItem | null>(null);
  const [answers, setAnswers] = useState<DoubtAnswerRow[]>([]);
  const [doubtAttachments, setDoubtAttachments] = useState<DoubtAttachmentRow[]>([]);
  const [answerAttachments, setAnswerAttachments] = useState<Record<string, DoubtAttachmentRow[]>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [replying, setReplying] = useState(false);

  const classGrade = useMemo(() => parseClassGrade(classLabel), [classLabel]);
  const chapterOptions = useMemo(
    () => (askSubject ? getNcertChapters(classGrade, askSubject) : []),
    [classGrade, askSubject],
  );
  const askAttachControls = useMemo(() => listDoubtAttachControls(), []);
  const replyAttachControls = useMemo(() => listDoubtAttachControls(["image", "voice"]), []);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setSubjectsLoading(true);
      setSubjectsError(null);
      try {
        const list = await DoubtService.listSubjectsForStudentClass(ctx);
        if (cancelled) return;
        setSubjects(list);
        setAskSubject((prev) =>
          prev && list.some((s) => s.subject === prev) ? prev : (list[0]?.subject ?? ""),
        );
      } catch (e) {
        if (cancelled) return;
        const msg = toErrorMessage(e, "Could not load class subjects");
        setSubjects([]);
        setSubjectsError(msg);
        toast.error(msg);
      } finally {
        if (!cancelled) setSubjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId]);

  useEffect(() => {
    setAskSubjectId(subjects.find((s) => s.subject === askSubject)?.subjectId ?? null);
  }, [subjects, askSubject]);

  useEffect(() => {
    setAskChapter((prev) => (prev && chapterOptions.includes(prev) ? prev : ""));
  }, [chapterOptions]);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      const isFirstLoad = !feedLoadedRef.current;
      if (isFirstLoad) setLoading(true);
      setError(null);
      try {
        const rows = await DoubtService.list(ctx, {
          classId: classId ?? undefined,
          subject: subjectFilter !== "all" ? subjectFilter : undefined,
          status: statusFilter,
          mineOnly: scopeFilter === "mine",
        });
        if (cancelled) return;
        const withCounts = await Promise.all(
          rows.map(async (row) => {
            try {
              const atts = await DoubtService.listDoubtAttachments(ctx, row.id);
              return { ...row, attachmentCount: atts.length + (row.image_url ? 1 : 0) };
            } catch {
              return { ...row, attachmentCount: row.image_url ? 1 : 0 };
            }
          }),
        );
        if (!cancelled) {
          setItems(withCounts);
          feedLoadedRef.current = true;
        }
      } catch (e) {
        if (!cancelled) {
          setItems([]);
          setError(toErrorMessage(e, "Could not load doubts"));
          toast.error(toErrorMessage(e, "Could not load doubts"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId, subjectFilter, statusFilter, scopeFilter, liveVersion]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (d) =>
        d.body.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        d.student_name.toLowerCase().includes(q) ||
        d.subject.toLowerCase().includes(q) ||
        (d.chapter ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  function openAskAttach(kind?: DoubtAttachKind) {
    setAskAccept(kind ? DOUBT_ATTACH_ACCEPT[kind] : DOUBT_FILE_ACCEPT);
    queueMicrotask(() => askFileRef.current?.click());
  }

  function openReplyAttach(kind?: DoubtAttachKind) {
    setReplyAccept(kind ? DOUBT_ATTACH_ACCEPT[kind] : DOUBT_FILE_ACCEPT);
    queueMicrotask(() => replyFileRef.current?.click());
  }

  function onAskAttachControl(kind: DoubtAttachKind, presentation: "live" | "coming_soon", label: string) {
    if (presentation === "coming_soon") {
      notifyDoubtAttachComingSoon(label);
      return;
    }
    openAskAttach(kind);
  }

  function onReplyAttachControl(kind: DoubtAttachKind, presentation: "live" | "coming_soon", label: string) {
    if (presentation === "coming_soon") {
      notifyDoubtAttachComingSoon(label);
      return;
    }
    openReplyAttach(kind);
  }

  async function openDetail(id: string) {
    if (!ctx) return;
    setSelectedId(id);
    setView("detail");
    setDetailLoading(true);
    setReplyText("");
    setReplyFiles([]);
    try {
      const [row, ans, atts] = await Promise.all([
        DoubtService.get(ctx, id),
        DoubtService.listAnswers(ctx, id),
        DoubtService.listDoubtAttachments(ctx, id),
      ]);
      if (!row) {
        toast.error("Doubt not found");
        setView("feed");
        return;
      }
      setDetail({ ...row, attachmentCount: atts.length + (row.image_url ? 1 : 0) });
      setAnswers(ans);
      setDoubtAttachments(atts);
      const byAnswer: Record<string, DoubtAttachmentRow[]> = {};
      await Promise.all(
        ans.map(async (a) => {
          try {
            byAnswer[a.id] = await DoubtService.listAnswerAttachments(ctx, a.id);
          } catch {
            byAnswer[a.id] = [];
          }
        }),
      );
      setAnswerAttachments(byAnswer);
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not open doubt"));
      setView("feed");
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitAsk() {
    if (!ctx || !classId || asking) return;
    const body = askBody.trim();
    if (!body) {
      toast.error("Write your doubt first");
      return;
    }
    if (!askSubject.trim()) {
      toast.error("Select a subject");
      return;
    }
    setAsking(true);
    try {
      const uploaded: DoubtUploadMeta[] = [];
      for (const file of askFiles) {
        uploaded.push(await uploadDoubtAttachment(file, ctx.schoolId, classId));
      }
      const id = await DoubtService.create(ctx, {
        subject: askSubject.trim(),
        subjectId: askSubjectId,
        chapter: askChapter.trim() || undefined,
        content: body,
        attachments: uploaded,
      });
      toast.success("Doubt posted to your class");
      setAskBody("");
      setAskChapter("");
      setAskFiles([]);
      setView("feed");
      await openDetail(String(id));
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not post doubt"));
    } finally {
      setAsking(false);
    }
  }

  async function submitReply() {
    if (!ctx || !detail || !classId || replying) return;
    const body = replyText.trim();
    if (!body) return;
    setReplying(true);
    try {
      const uploaded: DoubtUploadMeta[] = [];
      for (const file of replyFiles) {
        uploaded.push(await uploadDoubtAttachment(file, ctx.schoolId, classId));
      }
      await DoubtService.reply(ctx, {
        doubtId: detail.id,
        content: body,
        attachments: uploaded,
      });
      setReplyText("");
      setReplyFiles([]);
      toast.success("Answer posted");
      await openDetail(detail.id);
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not post answer"));
    } finally {
      setReplying(false);
    }
  }

  function onPickAskFiles(e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    if (list.length) setAskFiles((prev) => [...prev, ...list].slice(0, 8));
    e.target.value = "";
  }

  function onPickReplyFiles(e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    if (list.length) setReplyFiles((prev) => [...prev, ...list].slice(0, 8));
    e.target.value = "";
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading doubtsâ€¦
      </div>
    );
  }

  if (!ctx || !classId) {
    return (
      <GlassCard className="p-8 text-center space-y-2">
        <AlertCircle className="w-5 h-5 text-amber-400 mx-auto" />
        <p className="text-sm text-foreground font-semibold">Class not linked</p>
        <p className="text-xs text-muted-foreground">
          Your student profile needs a class before you can use the Doubt Portal.
        </p>
      </GlassCard>
    );
  }

  if (view === "ask") {
    return (
      <div className="space-y-4 max-w-2xl">
        <button
          type="button"
          onClick={() => setView("feed")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back to Doubts
        </button>
        <GlassCard className="p-5 space-y-4">
          <div>
            <h2 className="text-lg font-black text-foreground" style={{ fontFamily: "var(--font-display)" }}>
              Ask a doubt
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Visible to your class and the teacher for that subject.
            </p>
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Subject</label>
            <select
              value={askSubject}
              onChange={(e) => {
                const sub = e.target.value;
                setAskSubject(sub);
                setAskSubjectId(subjects.find((s) => s.subject === sub)?.subjectId ?? null);
                setAskChapter("");
              }}
              disabled={subjectsLoading || !!subjectsError || subjects.length === 0}
              className="mt-1 w-full bg-black/5 border border-black/10 rounded-xl px-3 py-2.5 text-sm text-foreground outline-none disabled:opacity-60"
            >
              {subjectsLoading && <option value="">Loading subjectsâ€¦</option>}
              {!subjectsLoading && subjectsError && (
                <option value="">Could not load subjects</option>
              )}
              {!subjectsLoading && !subjectsError && subjects.length === 0 && (
                <option value="">No subjects mapped yet</option>
              )}
              {subjects.map((s) => (
                <option key={s.subject} value={s.subject} className="bg-card text-foreground">
                  {s.subject}
                </option>
              ))}
            </select>
            {subjectsError && (
              <p className="mt-1.5 text-[11px] text-destructive flex items-start gap-1.5">
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                {subjectsError}
              </p>
            )}
            {!subjectsLoading && !subjectsError && subjects.length === 0 && (
              <p className="mt-1.5 text-[11px] text-amber-400/90">
                Ask admin to assign Teacherâ€“Classâ€“Subject for your class.
              </p>
            )}
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Chapter</label>
            <select
              value={askChapter}
              onChange={(e) => setAskChapter(e.target.value)}
              disabled={!askSubject || chapterOptions.length === 0}
              className="mt-1 w-full bg-black/5 border border-black/10 rounded-xl px-3 py-2.5 text-sm text-foreground outline-none disabled:opacity-60"
            >
              <option value="" className="bg-card text-foreground">
                {!askSubject
                  ? "Select a subject first"
                  : chapterOptions.length
                    ? "Select chapter (optional)â€¦"
                    : "No chapters listed"}
              </option>
              {chapterOptions.map((c) => (
                <option key={c} value={c} className="bg-card text-foreground">
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Your doubt</label>
            <textarea
              value={askBody}
              onChange={(e) => setAskBody(e.target.value)}
              rows={6}
              placeholder="Describe what youâ€™re stuck onâ€¦"
              className="mt-1 w-full bg-black/5 border border-black/10 rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:border-[#3b5bdb]/40"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
              Attach (optional)
            </label>
            <input
              ref={askFileRef}
              type="file"
              accept={askAccept}
              multiple
              className="hidden"
              onChange={onPickAskFiles}
            />
            <div className="flex flex-wrap gap-2">
              {askAttachControls.map((a) => {
                const soon = a.presentation === "coming_soon";
                return (
                  <button
                    key={a.id}
                    type="button"
                    title={soon ? `${a.label} â€” ${COMING_SOON_LABEL}` : a.label}
                    onClick={() => onAskAttachControl(a.id, a.presentation, a.label)}
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all",
                      soon
                        ? "border-black/10 text-muted-foreground/70 hover:bg-black/5"
                        : "border-[#3b5bdb]/35 text-muted-foreground hover:bg-[#3b5bdb]/10 hover:text-foreground",
                    )}
                  >
                    {DOUBT_ATTACH_ICONS[a.id]}
                    {a.label}
                    {soon && (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground/80">
                        {COMING_SOON_LABEL}
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => openAskAttach()}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[#3b5bdb]/35 text-muted-foreground hover:bg-[#3b5bdb]/10 hover:text-foreground"
              >
                <Paperclip className="w-3.5 h-3.5" />
                Files
              </button>
            </div>
            <FileChips
              files={askFiles.map((f) => ({ name: f.name }))}
              onRemove={(i) => setAskFiles((prev) => prev.filter((_, idx) => idx !== i))}
            />
          </div>
          <button
            type="button"
            disabled={asking || subjectsLoading || !!subjectsError || !askBody.trim() || !askSubject}
            onClick={() => void submitAsk()}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold py-2.5 disabled:opacity-40"
          >
            {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Post doubt
          </button>
        </GlassCard>
      </div>
    );
  }

  if (view === "detail" && selectedId) {
    return (
      <div className="space-y-4 max-w-3xl">
        <button
          type="button"
          onClick={() => {
            setView("feed");
            setSelectedId(null);
          }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back to Doubts
        </button>

        {detailLoading || !detail ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading doubtâ€¦
          </div>
        ) : (
          <>
            <GlassCard className="p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <SubjectBadge subject={detail.subject} />
                {detail.chapter ? (
                  <span className="text-[10px] text-muted-foreground">{detail.chapter}</span>
                ) : null}
                <StatusChip status={detail.status} />
                {detail.user_id === ctx.userId && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/12 text-muted-foreground">
                    Mine
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{detail.body}</p>
              {detail.image_url && (
                <a href={detail.image_url} target="_blank" rel="noreferrer" className="block">
                  <img src={detail.image_url} alt="Attachment" className="max-h-56 rounded-xl border border-black/10" />
                </a>
              )}
              <AttachmentList rows={doubtAttachments} />
              <div className="flex items-center gap-2 pt-2 border-t border-black/5 text-xs text-muted-foreground">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black text-foreground"
                  style={{
                    background: `${subjectColor[detail.subject] || "#3b5bdb"}`,
                  }}
                >
                  {initials(detail.student_name)}
                </div>
                <span>
                  {detail.student_name} Â· {formatWhen(detail.created_at).full}
                </span>
                {detail.solved_at && (
                  <span className="ml-auto text-emerald-400/80">
                    Solved {formatWhen(detail.solved_at).full}
                  </span>
                )}
              </div>
            </GlassCard>

            <div className="space-y-3">
              <div className="text-xs font-bold text-foreground">
                Answers ({answers.length})
              </div>
              {answers.length === 0 ? (
                <GlassCard className="p-6 text-center text-xs text-muted-foreground">
                  No answers yet. Be the first to help.
                </GlassCard>
              ) : (
                answers.map((a) => {
                  const isTeacher = a.author_role === "teacher" || a.author_role === "admin";
                  const solvedThis = detail.solved_by_answer_id === a.id;
                  return (
                    <GlassCard
                      key={a.id}
                      className={cn(
                        "p-4 space-y-2",
                        solvedThis && "border-emerald-500/25 bg-emerald-500/5",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground">{a.author_name}</span>
                        {isTeacher && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400">
                            Teacher
                          </span>
                        )}
                        {solvedThis && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-400/15 text-emerald-400">
                            First answer
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {formatWhen(a.created_at).full}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{a.body}</p>
                      <AttachmentList rows={answerAttachments[a.id] ?? []} />
                    </GlassCard>
                  );
                })
              )}
            </div>

            <GlassCard className="p-4 space-y-3">
              <div className="text-xs font-bold text-foreground">Add an answer</div>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={3}
                placeholder="Write an answerâ€¦ (you can still answer after itâ€™s solved)"
                className="w-full bg-black/5 border border-black/10 rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:border-[#3b5bdb]/40"
              />
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={replyFileRef}
                  type="file"
                  accept={replyAccept}
                  multiple
                  className="hidden"
                  onChange={onPickReplyFiles}
                />
                {replyAttachControls.map((a) => {
                  const soon = a.presentation === "coming_soon";
                  return (
                    <button
                      key={a.id}
                      type="button"
                      title={soon ? `${a.label} â€” ${COMING_SOON_LABEL}` : a.label}
                      onClick={() => onReplyAttachControl(a.id, a.presentation, a.label)}
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border transition-all",
                        soon
                          ? "border-black/10 text-muted-foreground/70 hover:bg-black/5"
                          : "border-black/10 text-muted-foreground hover:bg-black/5 hover:text-foreground",
                      )}
                    >
                      {DOUBT_ATTACH_ICONS[a.id]}
                      {a.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => openReplyAttach()}
                  className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  Attach
                </button>
                <FileChips
                  files={replyFiles.map((f) => ({ name: f.name }))}
                  onRemove={(i) => setReplyFiles((prev) => prev.filter((_, idx) => idx !== i))}
                />
                <button
                  type="button"
                  disabled={replying || !replyText.trim()}
                  onClick={() => void submitReply()}
                  className="ml-auto inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold px-4 py-2 disabled:opacity-40"
                >
                  {replying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Post answer
                </button>
              </div>
            </GlassCard>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-black text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            Doubts
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Class feed â€” ask questions and help classmates. First answer marks a doubt solved.
          </p>
          {error && <p className="text-[10px] text-destructive mt-1">{error}</p>}
        </div>
        <button
          type="button"
          onClick={() => setView("ask")}
          className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold px-3.5 py-2.5"
        >
          <Plus className="w-3.5 h-3.5" /> Ask a doubt
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading doubtsâ€¦
        </div>
      ) : (
      <>
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 bg-black/5 border border-black/10 rounded-xl px-3 py-2 flex-1 min-w-48">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search doubtsâ€¦"
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 bg-black/5 border border-black/10 rounded-xl px-2 py-1.5">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-transparent text-xs text-foreground outline-none"
          >
            <option value="all" className="bg-card text-foreground">All status</option>
            <option value="open" className="bg-card text-foreground">Open</option>
            <option value="solved" className="bg-card text-foreground">Solved</option>
          </select>
        </div>
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="bg-black/5 border border-black/10 rounded-xl px-3 py-2 text-xs text-foreground outline-none"
        >
          <option value="all" className="bg-card text-foreground">All subjects</option>
          {subjects.map((s) => (
            <option key={s.subject} value={s.subject} className="bg-card text-foreground">
              {s.subject}
            </option>
          ))}
        </select>
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
          className="bg-black/5 border border-black/10 rounded-xl px-3 py-2 text-xs text-foreground outline-none"
        >
          <option value="all" className="bg-card text-foreground">Whole class</option>
          <option value="mine" className="bg-card text-foreground">Mine</option>
        </select>
      </div>

      {subjectsError && (
        <p className="text-[11px] text-destructive flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0" />
          Subjects unavailable: {subjectsError}
        </p>
      )}

      {filtered.length === 0 ? (
        <GlassCard className="p-10 text-center space-y-2">
          <MessageCircle className="w-6 h-6 text-muted-foreground mx-auto" />
          <p className="text-sm text-foreground font-semibold">No doubts yet</p>
          <p className="text-xs text-muted-foreground">
            {error
              ? "Could not load the class feed. Try again shortly."
              : "When you or a classmate posts a doubt, it will show up here."}
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {filtered.map((d) => {
            const when = formatWhen(d.created_at);
            return (
              <GlassCard
                key={d.id}
                className="p-4 hover:border-black/20 cursor-pointer transition-all group"
                onClick={() => void openDetail(d.id)}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black text-foreground shrink-0"
                    style={{
                      background: `${subjectColor[d.subject] || "#3b5bdb"}`,
                    }}
                  >
                    {initials(d.student_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <SubjectBadge subject={d.subject} />
                      {d.chapter ? (
                        <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">{d.chapter}</span>
                      ) : null}
                      <StatusChip status={d.status} />
                      {d.user_id === ctx.userId && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/12 text-muted-foreground">
                          Mine
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-foreground leading-snug line-clamp-2">{d.body || d.title}</p>
                    <div className="flex items-center gap-3 mt-2.5 text-[10px] text-muted-foreground">
                      <span>
                        {d.student_name} Â· {when.date}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        {d.answer_count ?? 0}
                      </span>
                      {d.attachmentCount > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Paperclip className="w-3 h-3" />
                          {d.attachmentCount}
                        </span>
                      )}
                      <span className="ml-auto text-muted-foreground opacity-0 group-hover:opacity-100 flex items-center gap-1">
                        Open <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}