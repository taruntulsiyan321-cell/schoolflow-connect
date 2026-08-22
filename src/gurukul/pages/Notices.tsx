import { useEffect, useMemo, useState } from "react";
import { Bell, Loader2, Megaphone, Paperclip } from "lucide-react";
import {
  AnnouncementService,
  useAcademicLive,
  type AnnouncementPriority,
  type TeacherAnnouncementRow,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { GlassCard, cn } from "@/gurukul/components/shared";
import { toast } from "sonner";

const PRIORITY_STYLES: Record<
  AnnouncementPriority,
  { label: string; color: string; bg: string }
> = {
  normal: { label: "Normal", color: "#78788c", bg: "rgba(120,120,140,0.15)" },
  important: { label: "Important", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
  urgent: { label: "Urgent", color: "#cc5069", bg: "rgba(204,80,105,0.15)" },
};

function PriorityChip({ priority }: { priority: AnnouncementPriority }) {
  const cfg = PRIORITY_STYLES[priority];
  return (
    <span
      className="text-[9px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: cfg.color, background: cfg.bg }}
    >
      {cfg.label}
    </span>
  );
}

/**
 * Student Notices — AnnouncementService.listPublishedForStudent only.
 * Honest empty when none; never fake notices.
 */
export default function Notices() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["profile"]);
  const [rows, setRows] = useState<TeacherAnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) {
      endLoading(setLoading);
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      beginLoading(setLoading);
      try {
        const list = await AnnouncementService.listPublishedForStudent(ctx);
        if (!cancelled) {
          setRows(list);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          const msg = e instanceof Error ? e.message : "Failed to load notices";
          setError(msg);
          toast.error(msg);
        }
      } finally {
        if (!cancelled) endLoading(setLoading);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  const detail = useMemo(
    () => rows.find((r) => r.id === selected) ?? null,
    [rows, selected],
  );

  const openAttachment = (notice: TeacherAnnouncementRow) => {
    const url = notice.attachmentUrl?.trim();
    if (!url) {
      toast.info("No attachment link is available for this notice.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (showLoading(loading)) {
    return (
      <div className="flex items-center justify-center py-16 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading notices…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1
          className="text-3xl font-black text-white"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Notices
        </h1>
        <p className="text-[#78788c] text-sm mt-1">
          AnnouncementService · {rows.length} published
        </p>
        {error && <p className="text-[10px] text-[#cc5069] mt-1">{error}</p>}
      </div>

      {rows.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <Bell className="w-10 h-10 mx-auto mb-3 text-[#46465a]" />
          <p className="text-sm text-[#78788c]">
            No published notices yet. Your school will post class and school announcements here.
          </p>
        </GlassCard>
      ) : (
        <div className={cn("grid gap-4", detail ? "grid-cols-1 lg:grid-cols-5" : "grid-cols-1")}>
          <div className={cn("space-y-2", detail ? "lg:col-span-2" : "")}>
            {rows.map((notice) => {
              const classLabel =
                [notice.targetClass, notice.targetSection].filter(Boolean).join(" ") ||
                (notice.audience === "all" ? "School" : "Class");
              return (
                <button
                  key={notice.id}
                  type="button"
                  onClick={() => setSelected(notice.id)}
                  className={cn(
                    "w-full text-left rounded-2xl border transition-all",
                    selected === notice.id
                      ? "bg-[#3b5bdb]/8 border-[#3b5bdb]/25"
                      : "bg-surface/80 border-border/70 hover:border-border",
                  )}
                >
                  <GlassCard className="p-4 border-0 bg-transparent shadow-none">
                    <div className="flex items-start gap-3">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: PRIORITY_STYLES[notice.priority].bg }}
                      >
                        <Megaphone
                          className="w-4 h-4"
                          style={{ color: PRIORITY_STYLES[notice.priority].color }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <PriorityChip priority={notice.priority} />
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#3b5bdb]/15 text-[#3b5bdb]">
                            {classLabel}
                          </span>
                          {notice.hasAttachment && (
                            <Paperclip className="w-3 h-3 text-[#46465a]" />
                          )}
                        </div>
                        <div className="text-sm font-semibold text-white">{notice.title}</div>
                        <div className="text-[11px] text-[#78788c] mt-1 line-clamp-2">
                          {notice.body}
                        </div>
                        <div className="text-[10px] text-[#46465a] mt-1.5">
                          {notice.publishedAt ?? "—"}
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                </button>
              );
            })}
          </div>

          {detail && (
            <GlassCard className={cn("p-5 space-y-4", "lg:col-span-3")}>
              <div className="flex items-start justify-between gap-3">
                <PriorityChip priority={detail.priority} />
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-[#46465a] hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>
              <div>
                <div className="text-lg font-bold text-white">{detail.title}</div>
                <div className="text-[11px] text-[#78788c] mt-1">
                  {[detail.targetClass, detail.targetSection].filter(Boolean).join(" ") ||
                    (detail.audience === "all" ? "School-wide" : "Class notice")}
                  {" · "}
                  {detail.publishedAt ?? "—"}
                </div>
              </div>
              <div className="text-sm text-[#b0b0c0] leading-relaxed whitespace-pre-wrap">
                {detail.body}
              </div>
              {detail.hasAttachment && (
                <button
                  type="button"
                  onClick={() => openAttachment(detail)}
                  disabled={!detail.attachmentUrl}
                  title={
                    detail.attachmentUrl
                      ? "Open attachment"
                      : "Attachment link is missing"
                  }
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 text-xs font-semibold text-[#a5b4fc] hover:bg-[#6366f1]/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  {detail.attachmentName ?? "Attachment"}
                </button>
              )}
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
}
