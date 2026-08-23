import { useEffect, useMemo, useState } from "react";
import { GlassCard, SectionLabel, SubjectBadge, subjectColor } from "@/gurukul/components/shared";
import { FileText, Video, Download, Search, Loader2, ExternalLink } from "lucide-react";
import { ResourceService, type LearningResourceRow } from "@/academic";
import { publicAcademicFileUrl } from "@/academic/storage/academicFileUpload";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toast } from "sonner";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";

function formatDate(iso: string | null) {
  if (!iso) return "â€”";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "â€”";
  }
}

function resolveResourceUrl(r: LearningResourceRow): string | null {
  if (r.url?.trim()) return r.url.trim();
  if (r.storagePath?.trim()) return publicAcademicFileUrl(r.storagePath);
  return null;
}

export default function Resources() {
  const { ctx, ready, classId } = useAcademicContext();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<LearningResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

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
        const list = await ResourceService.listForStudent(ctx, { classId: classId ?? null });
        if (!cancelled) setRows(list);
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          toast.error(e instanceof Error ? e.message : "Failed to load resources");
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
    const url = resolveResourceUrl(r);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    toast.info("No download link available for this material yet.");
  };

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search resourcesâ€¦"
          className="w-full bg-muted border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[#3b5bdb]/50 transition-colors"
        />
      </div>

      <GlassCard className="p-5">
        <SectionLabel>Study materials</SectionLabel>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading resourcesâ€¦
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => {
              const col = subjectColor[r.subject] ?? "#78788c";
              const hasLink = Boolean(resolveResourceUrl(r));
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
                        {r.type} Â· {formatDate(r.publishedAt)}
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
              <div className="text-center py-8 text-muted-foreground text-sm">
                {q
                  ? "No resources found."
                  : "No study materials uploaded for your class yet."}
              </div>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
