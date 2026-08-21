import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Search,
  Check,
  ChevronDown,
  Paperclip,
  Send,
  Filter,
  Loader2,
  X,
  AlertCircle,
  Flame,
} from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import {
  DoubtService,
  useAcademicLive,
  uploadDoubtAttachment,
  signedDoubtUrl,
  DOUBT_FILE_ACCEPT,
  computeDoubtUrgency,
  RiskBadge,
  type DoubtRow,
  type DoubtAnswerRow,
  type DoubtAttachmentRow,
  type DoubtUploadMeta,
  type DoubtStatus,
  type TeacherDoubtDashboard,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { useTeacherIdentity, teacherInitials } from "./useTeacherIdentity";
import { toast } from "sonner";

type Assignment = {
  classId: string;
  className: string;
  section: string;
  subject: string;
  subjectId: string | null;
};

type UiDoubt = {
  row: DoubtRow & { status: DoubtStatus };
  replies: DoubtAnswerRow[];
  attachments: DoubtAttachmentRow[];
  answerAttachments: Record<string, DoubtAttachmentRow[]>;
};

function parseClassLabel(label: string): { className: string; section: string } {
  const parts = String(label || "Class").trim().split(/\s+/);
  if (parts.length >= 2) {
    return { className: parts.slice(0, -1).join(" "), section: parts[parts.length - 1] };
  }
  return { className: label || "—", section: "" };
}

function AttachmentChips({ rows }: { rows: DoubtAttachmentRow[] }) {
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
    <div className="flex flex-wrap gap-1.5 mt-2">
      {rows.map((a) => (
        <a
          key={a.id}
          href={urls[a.id]}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded-lg bg-[#6366f1]/10 text-muted-foreground",
            !urls[a.id] && "opacity-50 pointer-events-none",
          )}
        >
          <Paperclip className="w-2.5 h-2.5" />
          <span className="max-w-[120px] truncate">{a.file_name}</span>
        </a>
      ))}
    </div>
  );
}

export default function Doubts() {
  const { ctx, ready } = useAcademicContext();
  const identity = useTeacherIdentity();
  const liveVersion = useAcademicLive(["doubt", "profile"]);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [doubts, setDoubts] = useState<UiDoubt[]>([]);
  const [attention, setAttention] = useState<TeacherDoubtDashboard["attention"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DoubtStatus>("all");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [replyFiles, setReplyFiles] = useState<Record<string, File[]>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const loadedRef = useRef(false);

  const teacherTag = teacherInitials(identity.name, "T");

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const pairs = await DoubtService.listTeacherAssignments(ctx);
        if (!cancelled) setAssignments(pairs);
      } catch {
        if (!cancelled) setAssignments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx]);

  // Triage queue — rpc_teacher_doubt_dashboard() is already deployed and
  // RLS-scoped; this was the first frontend caller. Independent of the
  // filtered list below, so it loads (and refreshes on realtime doubt
  // events) on its own.
  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const dash = await DoubtService.getTeacherDashboard(ctx);
        if (!cancelled) setAttention(dash.attention);
      } catch {
        if (!cancelled) setAttention([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    const isFirst = !loadedRef.current;
    (async () => {
      if (isFirst) setLoading(true);
      setError(null);
      try {
        const selected =
          assignmentFilter === "all"
            ? null
            : assignments.find(
                (a) => `${a.classId}::${a.subject}` === assignmentFilter,
              ) ?? null;

        const rows = await DoubtService.list(ctx, {
          classId: selected?.classId,
          subject: selected?.subject,
          subjectId: selected?.subjectId ?? undefined,
          status: statusFilter,
        });
        if (cancelled) return;

        const mapped = await Promise.all(
          rows.map(async (row) => {
            try {
              const [replies, attachments] = await Promise.all([
                DoubtService.listAnswers(ctx, row.id),
                DoubtService.listDoubtAttachments(ctx, row.id),
              ]);
              const answerAttachments: Record<string, DoubtAttachmentRow[]> = {};
              await Promise.all(
                replies.map(async (a) => {
                  try {
                    answerAttachments[a.id] = await DoubtService.listAnswerAttachments(ctx, a.id);
                  } catch {
                    answerAttachments[a.id] = [];
                  }
                }),
              );
              return { row, replies, attachments, answerAttachments };
            } catch {
              return {
                row,
                replies: [] as DoubtAnswerRow[],
                attachments: [] as DoubtAttachmentRow[],
                answerAttachments: {} as Record<string, DoubtAttachmentRow[]>,
              };
            }
          }),
        );
        if (!cancelled) {
          setDoubts(mapped);
          loadedRef.current = true;
        }
      } catch (e) {
        if (!cancelled) {
          setDoubts([]);
          setError(e instanceof Error ? e.message : "Could not load doubts");
          toast.error(e instanceof Error ? e.message : "Could not load doubts");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion, statusFilter, assignmentFilter, assignments]);

  const filtered = useMemo(
    () =>
      doubts.filter((d) => {
        const q = search.toLowerCase();
        if (!q) return true;
        return (
          d.row.student_name.toLowerCase().includes(q) ||
          d.row.body.toLowerCase().includes(q) ||
          d.row.title.toLowerCase().includes(q) ||
          d.row.subject.toLowerCase().includes(q)
        );
      }),
    [doubts, search],
  );

  // Deterministic urgency (age + visibility) over the already-ranked attention
  // set from rpc_teacher_doubt_dashboard — top 5 shown, highest score first.
  const triage = useMemo(
    () =>
      attention
        .map((row) => ({ row, urgency: computeDoubtUrgency({ createdAt: row.created_at, viewCount: row.view_count }) }))
        // A fresh, unviewed doubt isn't something to flag as "needs attention" yet.
        .filter((x) => x.urgency.band !== "low")
        .sort((a, b) => b.urgency.score - a.urgency.score)
        .slice(0, 5),
    [attention],
  );

  function jumpToDoubt(id: string) {
    setStatusFilter("all");
    setAssignmentFilter("all");
    setExpandedId(id);
  }

  async function sendReply(id: string) {
    const text = replyText[id]?.trim();
    if (!text || !ctx || busyIds.has(id)) return;
    const doubt = doubts.find((d) => d.row.id === id);
    if (!doubt?.row.class_id) {
      toast.error("Missing class on this doubt");
      return;
    }
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      const files = replyFiles[id] ?? [];
      const uploaded: DoubtUploadMeta[] = [];
      for (const file of files) {
        uploaded.push(await uploadDoubtAttachment(file, ctx.schoolId, doubt.row.class_id));
      }
      await DoubtService.reply(ctx, {
        doubtId: id,
        content: text,
        attachments: uploaded,
      });
      const [replies, attachments] = await Promise.all([
        DoubtService.listAnswers(ctx, id),
        DoubtService.listDoubtAttachments(ctx, id),
      ]);
      const answerAttachments: Record<string, DoubtAttachmentRow[]> = {};
      await Promise.all(
        replies.map(async (a) => {
          try {
            answerAttachments[a.id] = await DoubtService.listAnswerAttachments(ctx, a.id);
          } catch {
            answerAttachments[a.id] = [];
          }
        }),
      );
      const refreshed = await DoubtService.get(ctx, id);
      setDoubts((prev) =>
        prev.map((d) =>
          d.row.id === id
            ? {
                row: refreshed ?? { ...d.row, status: "solved" as DoubtStatus },
                replies,
                attachments,
                answerAttachments,
              }
            : d,
        ),
      );
      setReplyText((p) => ({ ...p, [id]: "" }));
      setReplyFiles((p) => ({ ...p, [id]: [] }));
      toast.success("Reply posted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post reply");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function onPickFiles(id: string, e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    if (list.length) {
      setReplyFiles((p) => ({
        ...p,
        [id]: [...(p[id] ?? []), ...list].slice(0, 8),
      }));
    }
    e.target.value = "";
  }

  const openCount = doubts.filter((d) => d.row.status === "open").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading doubts…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-foreground">Student Doubts</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {openCount} open · only your assigned class + subject
          </div>
          {error && <div className="text-[10px] text-[#cc5069] mt-1">{error}</div>}
        </div>
      </div>

      {triage.length > 0 && (
        <div className="rounded-2xl border border-[#cc5069]/20 bg-[#cc5069]/5 p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground mb-3">
            <Flame className="w-3.5 h-3.5" /> Needs attention — oldest / most-viewed unanswered first
          </div>
          <div className="space-y-2">
            {triage.map(({ row, urgency }) => (
              <button
                key={row.id}
                type="button"
                onClick={() => jumpToDoubt(row.id)}
                className="w-full flex items-center gap-3 rounded-xl bg-card border border-black/7 hover:border-black/15 px-3 py-2.5 text-left transition-all"
              >
                <RiskBadge band={urgency.band} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground truncate">{row.title || row.body}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">
                    {row.student_name} · {row.subject} · {urgency.age_hours < 1 ? "just now" : `${Math.round(urgency.age_hours)}h ago`}
                    {urgency.view_count > 0 ? ` · ${urgency.view_count} views` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {assignments.length === 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2.5 text-[11px] text-amber-200">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          No class–subject assignments found on your teacher profile. Doubts will stay empty until
          you are mapped in teacher classes.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 bg-black/5 border border-black/10 rounded-xl px-3 py-2 flex-1 min-w-48">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search doubts…"
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 bg-black/5 border border-black/10 rounded-xl px-2 py-1.5">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | DoubtStatus)}
            className="bg-transparent text-xs text-foreground outline-none"
          >
            <option value="all">All Status</option>
            <option value="open">Open</option>
            <option value="solved">Solved</option>
          </select>
        </div>
        <select
          value={assignmentFilter}
          onChange={(e) => setAssignmentFilter(e.target.value)}
          className="bg-black/5 border border-black/10 rounded-xl px-3 py-2 text-xs text-foreground outline-none max-w-[220px]"
        >
          <option value="all">All assignments</option>
          {assignments.map((a) => (
            <option key={`${a.classId}::${a.subject}`} value={`${a.classId}::${a.subject}`}>
              {a.className} {a.section} · {a.subject}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-xs text-muted-foreground">
          {error
            ? "Could not load doubts."
            : doubts.length === 0
              ? "No doubts for your assigned classes and subjects yet."
              : "No doubts match your filters."}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(({ row, replies, attachments, answerAttachments }) => {
          const { className, section } = parseClassLabel(row.class_label);
          const status = row.status;
          const hasAttachment = attachments.length > 0 || Boolean(row.image_url);
          return (
            <div
              key={row.id}
              className={cn(
                "bg-card border rounded-2xl overflow-hidden transition-all",
                status === "open" ? "border-[#3b5bdb]/20" : "border-black/7",
              )}
            >
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                className="w-full flex items-start gap-3 p-4 hover:bg-black/3 transition-all text-left"
              >
                <InitialsAvatar
                  name={row.student_name || "Student"}
                  color={status === "open" ? "#f59e0b" : "#46465a"}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-xs font-bold text-foreground">{row.student_name || "Student"}</div>
                    <span
                      className={cn(
                        "text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                        status === "open"
                          ? "bg-[#3b5bdb]/15 text-[#3b5bdb]"
                          : "bg-[#10b981]/15 text-[#10b981]",
                      )}
                    >
                      {status}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {className} {section} · {row.subject || "—"}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                    {row.body || row.title}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[9px] text-muted-foreground">
                    <span>{new Date(row.created_at).toLocaleString("en-IN")}</span>
                    {hasAttachment && (
                      <span className="flex items-center gap-0.5 text-[#6366f1]">
                        <Paperclip className="w-2.5 h-2.5" /> Attachment
                      </span>
                    )}
                    <span>
                      {replies.length} repl{replies.length !== 1 ? "ies" : "y"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {status === "open" && (
                    <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#10b981]/10 text-[#10b981] text-[9px] font-bold">
                      <Check className="w-3 h-3" /> Needs reply
                    </span>
                  )}
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 text-muted-foreground transition-transform",
                      expandedId === row.id && "rotate-180",
                    )}
                  />
                </div>
              </button>

              {expandedId === row.id && (
                <div className="border-t border-black/7 px-4 pb-4 space-y-3 pt-4">
                  <div className="p-3 rounded-xl bg-black/3 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {row.body || row.title}
                  </div>
                  <AttachmentChips rows={attachments} />
                  {row.image_url && (
                    <a
                      href={row.image_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[9px] text-muted-foreground"
                    >
                      <Paperclip className="w-2.5 h-2.5" /> Legacy image
                    </a>
                  )}

                  {replies.map((r) => {
                    const fromTeacher =
                      r.author_role === "teacher" ||
                      r.author_role === "admin" ||
                      r.author_role === "principal";
                    return (
                      <div key={r.id} className={cn("flex gap-3", fromTeacher && "flex-row-reverse")}>
                        <div
                          className="w-7 h-7 rounded-xl flex items-center justify-center text-[8px] font-black shrink-0"
                          style={{
                            background: fromTeacher ? "#f59e0b20" : "#6366f120",
                            color: fromTeacher ? "#f59e0b" : "#6366f1",
                          }}
                        >
                          {fromTeacher
                            ? teacherTag
                            : (row.student_name || "S")
                                .split(" ")
                                .map((w) => w[0])
                                .slice(0, 2)
                                .join("")}
                        </div>
                        <div className={cn("flex-1 max-w-[80%]", fromTeacher && "text-right")}>
                          <div
                            className={cn(
                              "inline-block px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap text-left",
                              fromTeacher
                                ? "bg-[#3b5bdb]/10 text-[#fcd34d]"
                                : "bg-black/5 text-muted-foreground",
                            )}
                          >
                            {r.body}
                          </div>
                          <AttachmentChips rows={answerAttachments[r.id] ?? []} />
                          <div className="text-[9px] text-muted-foreground mt-1">
                            {r.author_name} · {new Date(r.created_at).toLocaleString("en-IN")}
                            {row.solved_by_answer_id === r.id ? " · first answer" : ""}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex items-start gap-2 pt-2">
                    <div className="flex-1 space-y-2">
                      <textarea
                        value={replyText[row.id] ?? ""}
                        onChange={(e) =>
                          setReplyText((p) => ({ ...p, [row.id]: e.target.value }))
                        }
                        rows={2}
                        placeholder="Type your reply… (allowed even after solved)"
                        className="w-full bg-black/5 border border-black/10 rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-[#3b5bdb]/40 resize-none transition-all"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
                          <Paperclip className="w-3 h-3" />
                          Attach
                          <input
                            type="file"
                            accept={DOUBT_FILE_ACCEPT}
                            multiple
                            className="hidden"
                            onChange={(e) => onPickFiles(row.id, e)}
                          />
                        </label>
                        {(replyFiles[row.id] ?? []).map((f, i) => (
                          <span
                            key={`${f.name}-${i}`}
                            className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-lg bg-black/5 text-muted-foreground"
                          >
                            {f.name}
                            <button
                              type="button"
                              onClick={() =>
                                setReplyFiles((p) => ({
                                  ...p,
                                  [row.id]: (p[row.id] ?? []).filter((_, idx) => idx !== i),
                                }))
                              }
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void sendReply(row.id)}
                      disabled={!replyText[row.id]?.trim() || busyIds.has(row.id)}
                      className="w-9 h-9 rounded-xl bg-[#3b5bdb] text-black flex items-center justify-center hover:bg-[#d97706] disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
                    >
                      {busyIds.has(row.id) ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}