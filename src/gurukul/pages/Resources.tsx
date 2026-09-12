import { useEffect, useMemo, useState } from "react";
import { EmptyState, GlassCard, PageHeader, PageSkeleton, SectionLabel, Skeleton, SkeletonCard, SubjectBadge, subjectColor } from "@/gurukul/components/shared";
import { FileText, Video, Download, Search, ExternalLink } from "lucide-react";
import { ResourceService, type LearningResourceRow } from "@/academic";
import { academicFileUrl } from "@/academic/storage/academicFileUpload";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toast } from "sonner";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { toEnumLabel, toErrorMessage } from "@/lib/presentation";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

/**
 * What was STORED for this resource — a link, a durable bucket ref, or a bare
 * object path. Sync, because the render needs to know whether a row is openable
 * at all without waiting on a signature.
 */
function resourceRef(r: LearningResourceRow): string | null {
  const link = r.url?.trim();
  if (link) return link;
  const path = r.storagePath?.trim();
  return path || null;
}

export default function Resources() {
  const { ctx, ready, classId } = useAcademicContext();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<LearningResourceRow[]>([]);
  /**
   * Resolved hrefs by resource id. Signed URLs are fetched when the LIST
   * arrives, not on click: `academicFileUrl` is async, and resolving inside the
   * handler would put an await between the user's click and `window.open`,
   * which is exactly what a popup blocker cancels.
   */
  const [hrefs, setHrefs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate([classId]);

  useEffect(() => {
    // Still resolving is not loaded — see the long note in ClassHub.tsx.
    if (!ready) return;
    if (!ctx) {
      endLoading(setLoading);
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      beginLoading(setLoading);
      try {
        const list = await ResourceService.listForStudent(ctx, { classId: classId ?? null });
        if (cancelled) return;
        setRows(list);
        const resolved = await Promise.all(
          list.map(async (r) => [r.id, await academicFileUrl(resourceRef(r))] as const),
        );
        if (cancelled) return;
        setHrefs(Object.fromEntries(resolved.filter(([, u]) => u) as [string, string][]));
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          toast.error(toErrorMessage(e, "Failed to load resources"));
        }
      } finally {
        if (!cancelled) endLoading(setLoading);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          !q ||
          r.title.toLowerCase().includes(q.toLowerCase()) ||
          r.subject.toLowerCase().includes(q.toLowerCase()),
      ),
    [rows, q],
  );

  const openResource = (r: LearningResourceRow) => {
    const url = hrefs[r.id];
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    // A row WITH a ref whose signature has not landed is a different state from
    // a row with nothing attached, and saying so beats one message for both.
    toast.info(
      resourceRef(r)
        ? "That file is still being prepared — try again in a moment."
        : "No download link available for this material yet.",
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Class"
        title="Resources"
        subtitle="Notes, videos and past papers your teachers share with your class."
      />
      {/* A search box only while there is something to search.
          It rendered unconditionally before — above a spinner during the load,
          and above "No study materials yet" when the class had none. Offering
          a student a box to search an empty shelf is a control that cannot do
          anything: whatever they type, the answer is the same empty state. It
          appears once resources exist, and stays while a search narrows them
          to nothing so they can clear it. */}
      {(rows.length > 0 || q) && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search resources…"
            className="w-full bg-muted border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[#3b5bdb]/50 transition-colors"
          />
        </div>
      )}

      <GlassCard className="p-5">
        <SectionLabel>Study materials</SectionLabel>
        {loading ? (
          <PageSkeleton label="Loading resources" className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} className="p-4 flex items-center gap-3 bg-muted/30 shadow-none">
                <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </SkeletonCard>
            ))}
          </PageSkeleton>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => {
              const col = subjectColor[r.subject] ?? "#78788c";
              const hasLink = Boolean(resourceRef(r));
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openResource(r)}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border border-border/70 bg-muted/30 hover:border-border transition-colors group text-left"
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${col}15`, color: col }}
                  >
                    {r.type === "Video" ? <Video className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{r.title}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <SubjectBadge subject={r.subject} color={col} />
                      <span className="text-[11px] text-muted-foreground">
                        {toEnumLabel(r.type, "resource_type")} · {formatDate(r.publishedAt)}
                      </span>
                    </div>
                  </div>
                  <span className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {hasLink ? (
                      <ExternalLink className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <Download className="w-4 h-4 text-muted-foreground" />
                    )}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <EmptyState
                variant="section"
                icon={q ? <Search className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                title={q ? "No resources match your search" : "No study materials yet"}
                sub={
                  q
                    ? "Try a shorter search, or clear it to see everything for your class."
                    : "Notes, videos and papers your teachers upload for your class appear here."
                }
              />
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
