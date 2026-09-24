import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Copy, Eye, Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import {
  HomeworkService,
  WORK_KIND_LABELS,
  homeworkHasClosed,
  useAcademicLive,
  type ManagedHomeworkRow,
} from "@/academic";
import type { HomeworkStatus } from "@/academic/repository/homeworkRepository";
import { attachmentOfFile } from "@/academic/storage/academicFileUpload";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toEnumLabel, toErrorMessage } from "@/lib/presentation";
import { useResetOnIdentityChange } from "@/hooks/useInitialLoadGate";
import { AttachmentList } from "./AttachmentUI";
import { HomeworkForm, type HomeworkFormSource } from "./HomeworkForm";
import { HomeworkReview } from "./HomeworkReview";

type StatusFilter = "all" | HomeworkStatus;
/** What the form is open for: new homework, or editing / copying one. */
type FormOpen = { as: "new" } | HomeworkFormSource;

/** Homework is read a page at a time; older pages are fetched when the teacher asks for them.
 * 25 is enough for a usable page and keeps the jsdom paging unit test under the
 * default vitest budget when the whole suite shares the machine (KNOWN_ISSUES 77).
 * 100 forced that test to paint a full page of cards under contention. */
export const HOMEWORK_PAGE = 25;

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

/**
 * A class's homework: set, edit or copy it, publish or schedule it, review
 * hand-ins, delete. docs/gurukul-spec-rules.md, "Homework — RULED 2026-09-13".
 *
 * A teacher sees every subject's homework in a class they teach and changes
 * only their own subjects' (`canManage`, decided by the service). Released
 * homework whose deadline has passed is history: it can be archived or
 * deleted, and nothing else about it changes.
 */
export function LiveHomeworkTab({
  classId,
  classLabel,
  subject,
}: {
  classId: string;
  classLabel: string;
  subject: string | null;
}) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  const [items, setItems] = useState<ManagedHomeworkRow[]>([]);
  /** How many pages are on screen; a reload reads all of them again, so an action never drops older ones. */
  const [pages, setPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormOpen | null>(null);
  const [reviewing, setReviewing] = useState<ManagedHomeworkRow | null>(null);
  const [busy, setBusy] = useState(false);

  const readPages = async (count: number) => {
    if (!ctx) return;
    const read = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        HomeworkService.listForClass(ctx, classId, { limit: HOMEWORK_PAGE, offset: i * HOMEWORK_PAGE }),
      ),
    );
    setItems(read.flat());
    setHasMore(read[read.length - 1].length === HOMEWORK_PAGE);
  };

  const reload = async (count = pages) => {
    if (!ctx) return;
    if (!loadedRef.current) setLoading(true);
    try {
      await readPages(count);
      setError(null);
      loadedRef.current = true;
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load homework"));
    } finally {
      setLoading(false);
    }
  };

  useResetOnIdentityChange(loadedRef, classId);
  useEffect(() => {
    if (!ready || !ctx) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, classId, liveVersion]);

  const showOlder = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      await readPages(pages + 1);
      setPages((p) => p + 1);
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load older homework"));
    } finally {
      setLoadingMore(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (h) =>
        (statusFilter === "all" || h.status === statusFilter) &&
        (!q || h.title.toLowerCase().includes(q) || h.subject.toLowerCase().includes(q)),
    );
  }, [items, statusFilter, search]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, `${label} failed`));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-xs">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading homework…
      </div>
    );
  }

  if (reviewing) {
    return (
      <HomeworkReview
        homework={reviewing}
        classId={classId}
        canDecide={reviewing.canManage}
        onBack={() => {
          setReviewing(null);
          void reload();
        }}
      />
    );
  }

  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="text-sm font-bold text-foreground">Homework</div>
      {error && <div className="text-xs text-destructive">{error}</div>}

      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {(["all", "draft", "scheduled", "published", "archived"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {s === "all" ? "All" : toEnumLabel(s, "homework_status")}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="bg-muted border border-border rounded-[2px] px-3 py-1.5 text-[11px] text-foreground w-36"
          />
          <button
            type="button"
            onClick={() => setForm((f) => (f?.as === "new" ? null : { as: "new" }))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-[10px] font-bold bg-primary/15 text-primary"
          >
            <Plus className="w-3 h-3" /> New homework
          </button>
        </div>
      </div>

      {form && (
        <HomeworkForm
          key={form.as === "new" ? "new" : `${form.as}:${form.homework.id}`}
          classId={classId}
          classLabel={classLabel}
          subject={subject}
          source={form.as === "new" ? undefined : form}
          onCancel={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void reload();
          }}
        />
      )}

      <div className="text-[10px] text-muted-foreground">
        {filtered.length} homework{hasMore ? " — the newest; older homework is further down" : ""}
      </div>
      <div className="space-y-2">
        {filtered.map((h) => {
          const closed = homeworkHasClosed(h, now);
          return (
            <div key={h.id} className="p-4 bg-surface border border-border/70 rounded-[2px] space-y-2">
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-xs font-bold text-foreground">{h.title}</div>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-primary/15 text-primary">
                      {WORK_KIND_LABELS[h.workKind]}
                    </span>
                    {closed && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-muted text-muted-foreground">
                        Closed
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {h.subject} · Deadline {when(h.closesAt)} · {toEnumLabel(h.status, "homework_status")} ·{" "}
                    {toEnumLabel(h.priority, "homework_priority")}
                    {h.status === "scheduled" && h.scheduledPublishAt ? ` · goes out ${when(h.scheduledPublishAt)}` : ""}
                  </div>
                </div>
                {h.completion && (
                  <div className="text-right text-[10px] text-muted-foreground shrink-0">
                    {h.completion.given}/{h.completion.students} handed in · {h.completion.completionPct}%
                    <div>
                      {h.completion.awaitingReview} to review · {h.completion.rejected} rejected ·{" "}
                      {h.completion.notGiven} not given
                    </div>
                  </div>
                )}
              </div>
              {h.questionFile ? (
                <AttachmentList items={[attachmentOfFile(h.questionFile)]} dense />
              ) : (
                h.questionText && <div className="text-[10px] text-muted-foreground line-clamp-2">{h.questionText}</div>
              )}
              {ctx && (
                <div className="flex flex-wrap gap-2 items-center">
                  {h.status === "published" && (
                    <button
                      type="button"
                      onClick={() => setReviewing(h)}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" /> Hand-ins
                    </button>
                  )}
                  {!h.canManage && (
                    <span className="text-[10px] text-muted-foreground">
                      View only — you do not teach {h.subject} in this class
                    </span>
                  )}
                  {h.canManage && h.status !== "archived" && !closed && (
                    <button
                      type="button"
                      onClick={() => setForm({ as: "edit", homework: h })}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  )}
                  {h.canManage && (h.status === "draft" || h.status === "scheduled") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run("Publish", () => HomeworkService.publish(ctx, h.id))}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-primary/20 text-primary flex items-center gap-1"
                    >
                      <Send className="w-3 h-3" /> Publish now
                    </button>
                  )}
                  {h.canManage && h.status === "published" && !closed && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run("Unpublish", () => HomeworkService.unpublish(ctx, h.id))}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground"
                    >
                      Unpublish
                    </button>
                  )}
                  {h.canManage && h.status !== "archived" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run("Archive", () => HomeworkService.archive(ctx, h.id))}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-warning flex items-center gap-1"
                    >
                      <Archive className="w-3 h-3" /> Archive
                    </button>
                  )}
                  {h.canManage && (
                    <button
                      type="button"
                      onClick={() => setForm({ as: "copy", homework: h })}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> Duplicate
                    </button>
                  )}
                  {h.canManage && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Delete “${h.title}”? It leaves every student's count, and goes to the trash.`)) return;
                        void run("Delete", () => HomeworkService.remove(ctx, h.id));
                      }}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-destructive/15 text-destructive flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-xs text-muted-foreground">
            {items.length === 0 ? "No homework set for this class yet." : "No homework matches this filter."}
          </div>
        )}
        {hasMore && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void showOlder()}
            className="w-full py-2 rounded-[2px] text-[10px] font-bold bg-muted text-muted-foreground disabled:opacity-50"
          >
            {loadingMore ? "Loading older homework…" : "Show older homework"}
          </button>
        )}
      </div>
    </div>
  );
}
