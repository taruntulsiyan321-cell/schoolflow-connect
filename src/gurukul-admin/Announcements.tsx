import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Loader2, Megaphone, Send } from "lucide-react";
import {
  AnnouncementService,
  useAcademicLive,
  type AnnouncementStatus,
  type TeacherAnnouncementRow,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { cn } from "./shared";

/**
 * Admin announcements monitor — AnnouncementService.listForSchool only.
 * Publish drafts (same as principal). No local compose / fake data.
 */
export default function AnnouncementManagement() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["profile"]);
  const [rows, setRows] = useState<TeacherAnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | AnnouncementStatus>("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const reloadIdRef = useRef(0);

  const reload = async () => {
    if (!ready || !ctx) return;
    const requestId = ++reloadIdRef.current;
    setLoading(true);
    try {
      const list = await AnnouncementService.listForSchool(ctx);
      if (reloadIdRef.current !== requestId) return;
      setRows(list);
      setError(null);
    } catch (e) {
      if (reloadIdRef.current !== requestId) return;
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed to load announcements");
    } finally {
      if (reloadIdRef.current === requestId) setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, liveVersion]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((a) => {
      if (tab !== "all" && a.status !== tab) return false;
      if (!q) return true;
      const classLabel = [a.targetClass, a.targetSection].filter(Boolean).join(" ");
      return (
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q) ||
        classLabel.toLowerCase().includes(q)
      );
    });
  }, [rows, tab, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const row of rows) {
      c[row.status] = (c[row.status] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  async function publish(row: TeacherAnnouncementRow) {
    if (!ctx || !row.classId) return;
    setBusyId(row.id);
    try {
      await AnnouncementService.update(ctx, row.id, {
        title: row.title,
        body: row.body,
        classId: row.classId,
        priority: row.priority,
        status: "published",
        audience: row.audience,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-xs">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading announcements…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-muted-foreground">Announcements</h1>
          <p className="text-xs text-muted-foreground">
            AnnouncementService.listForSchool — live notices only
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title…"
          className="border border-[#e5e7eb] rounded-xl px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="text-xs text-[#cc5069]">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total", value: rows.length, color: "#3b5bdb" },
          { label: "Published", value: counts.published ?? 0, color: "#10b981" },
          { label: "Draft", value: counts.draft ?? 0, color: "#f59e0b" },
          { label: "Scheduled", value: counts.scheduled ?? 0, color: "#6882e8" },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-[#e5e7eb] bg-card p-4">
            <div className="text-xl font-bold tabular-nums" style={{ color: k.color }}>
              {k.value}
            </div>
            <div className="text-[11px] text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 p-1 bg-card border border-[#e5e7eb] rounded-2xl w-fit flex-wrap">
        {(["all", "published", "draft", "scheduled"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all",
              tab === t ? "bg-[#3b5bdb]/15 text-[#3b5bdb]" : "text-muted-foreground hover:text-muted-foreground",
            )}
          >
            {t}
            <span className="ml-1.5 text-[9px] tabular-nums opacity-70">{counts[t] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-[#e5e7eb] bg-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Bell className="w-8 h-8 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              No announcements yet. Teachers publish class notices via AnnouncementService.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[#f0f1f3]">
            {filtered.map((ann) => {
              const statusColor =
                ann.status === "published"
                  ? "#10b981"
                  : ann.status === "draft"
                    ? "#f59e0b"
                    : "#6882e8";
              const classLabel =
                [ann.targetClass, ann.targetSection].filter(Boolean).join(" ") || "—";
              return (
                <div key={ann.id} className="p-4 flex items-start gap-4">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${statusColor}18` }}
                  >
                    <Megaphone className="w-4 h-4" style={{ color: statusColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-bold text-muted-foreground">{ann.title}</span>
                      <span
                        className="text-[9px] font-bold px-2 py-0.5 rounded-full capitalize"
                        style={{ background: `${statusColor}18`, color: statusColor }}
                      >
                        {ann.status}
                      </span>
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {ann.audience}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Class: {classLabel} · {ann.publishedAt ?? ann.scheduledFor ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-2 line-clamp-2">{ann.body}</div>
                  </div>
                  {ann.status === "draft" && ann.classId && (
                    <button
                      type="button"
                      disabled={busyId === ann.id}
                      onClick={() => void publish(ann)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-foreground bg-[#3b5bdb] hover:bg-[#2f4fc4] disabled:opacity-50 shrink-0"
                    >
                      {busyId === ann.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      Publish
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}