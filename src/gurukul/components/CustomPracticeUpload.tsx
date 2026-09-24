/**
 * Custom Practice upload pane for individual (exam) students.
 * Spec: docs/custom-practice-upload-spec.md §4.3, §8
 *
 * §8 practise modes call `onSelectMode` so ConfigView can `onStart` with
 * `SessionConfig.upload`. `read_notes` stays here — toast / open notes only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAcademicContext } from "@/academic";
import {
  modesForVerdict,
  StudentUploadService,
  UPLOAD_MODE_LABELS,
  type StudentUploadNoteRow,
  type StudentUploadRow,
  type UploadPracticeMode,
} from "@/academic/services/studentUploadService";
import { STUDENT_UPLOAD_ACCEPT } from "@/academic/storage/studentUploadFile";
import { cn } from "@/gurukul/components/shared";
import { withAlpha } from "@/lib/colorAlpha";
import { FileUp, Loader2, Trash2, X } from "lucide-react";

type Props = {
  accentColor: string;
  /** Practise modes only — parent starts a session with SessionConfig.upload. */
  onSelectMode: (upload: StudentUploadRow, mode: UploadPracticeMode) => void;
};

const PRACTISE_MODES: ReadonlySet<UploadPracticeMode> = new Set([
  "practise_all",
  "practise_by_chapter",
  "practise_hard",
  "practise_from_notes",
]);

function statusLabel(row: StudentUploadRow): string {
  if (row.status === "pending") return "Waiting to classify…";
  if (row.status === "processing") return "Reading your file…";
  if (row.status === "failed") return row.refusal_reason || "Could not process this file.";
  if (row.status === "unusable") return row.refusal_reason || "This file could not be used for practice.";
  if (row.status === "ready") {
    if (row.verdict === "questions") return "Questions ready";
    if (row.verdict === "notes") return "Notes ready";
    if (row.verdict === "mixed") return "Questions and notes ready";
    return "Ready";
  }
  return row.status;
}

export function CustomPracticeUpload({ accentColor, onSelectMode }: Props) {
  const { ctx, ready: academicReady } = useAcademicContext();
  const [rows, setRows] = useState<StudentUploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<{
    uploadId: string;
    filename: string;
    notes: StudentUploadNoteRow[];
  } | null>(null);
  const [notesLoadingId, setNotesLoadingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!ctx || !academicReady) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRows(await StudentUploadService.listMine(ctx));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load your uploads");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [ctx, academicReady]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onPick(fileList: FileList | null) {
    if (!fileList?.length || !ctx) return;
    const files = Array.from(fileList);
    setUploading(true);
    try {
      // Multi-image pages → one pending row each; no questions invented client-side.
      const created = await StudentUploadService.create(ctx, files);
      setRows((prev) => [...created, ...prev]);
      let classifyMiss = false;
      for (const row of created) {
        setBusyId(row.id);
        const classify = await StudentUploadService.requestClassify(ctx, row.id);
        if (!classify.ok) classifyMiss = true;
      }
      if (classifyMiss) {
        toast.message("Classifier is not available yet — your file(s) are saved.");
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setBusyId(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onDelete(id: string) {
    if (!ctx) return;
    setBusyId(id);
    try {
      await StudentUploadService.remove(ctx, id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete upload");
    } finally {
      setBusyId(null);
    }
  }

  async function onRetryClassify(id: string) {
    if (!ctx) return;
    setBusyId(id);
    try {
      const r = await StudentUploadService.requestClassify(ctx, id);
      if (!r.ok) toast.error(r.error || "Classifier failed");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  /** §8 — practise modes → parent onStart(upload); read_notes opens notes here. */
  async function onModeClick(row: StudentUploadRow, mode: UploadPracticeMode) {
    if (mode === "read_notes") {
      if (!ctx) return;
      setNotesLoadingId(row.id);
      try {
        const notes = await StudentUploadService.listNotes(ctx, row.id);
        if (notes.length === 0) {
          toast.message("No notes extracted from this upload yet.");
          setNotesFor(null);
          return;
        }
        setNotesFor({ uploadId: row.id, filename: row.original_filename, notes });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not open notes");
      } finally {
        setNotesLoadingId(null);
      }
      return;
    }
    if (!PRACTISE_MODES.has(mode)) return;
    onSelectMode(row, mode);
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Your material
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Upload a PDF or photo of a question paper, worksheet, or notes. Only you can see it.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={STUDENT_UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          disabled={uploading || !ctx}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-3 rounded-2xl border text-sm font-bold transition-all",
            uploading ? "opacity-60" : "hover:border-border",
          )}
          style={{
            borderColor: withAlpha(accentColor, 0.3),
            background: withAlpha(accentColor, 0.06),
            color: accentColor,
          }}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
          {uploading ? "Uploading…" : "Upload PDF or image"}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your uploads…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No uploads yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const modes = modesForVerdict(row.verdict);
            const refused = row.status === "unusable" || row.verdict === "unusable";
            return (
              <li
                key={row.id}
                className="p-4 rounded-2xl border border-border/70 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-foreground truncate">
                      {row.original_filename}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{statusLabel(row)}</div>
                  </div>
                  <button
                    type="button"
                    title="Delete upload"
                    disabled={busyId === row.id}
                    onClick={() => void onDelete(row.id)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* §4.3 — honest refusal, no empty modes */}
                {refused && (
                  <p className="text-sm text-muted-foreground border border-border/50 rounded-xl px-3 py-2 bg-muted/30">
                    {row.refusal_reason || "This file could not be used for practice."}
                  </p>
                )}

                {(row.status === "pending" || row.status === "failed") && (
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void onRetryClassify(row.id)}
                    className="text-xs font-semibold text-primary"
                  >
                    {busyId === row.id ? "Working…" : "Classify again"}
                  </button>
                )}

                {row.status === "ready" && modes.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {modes.map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={notesLoadingId === row.id}
                        onClick={() => void onModeClick(row, m)}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold border border-border/70 hover:border-border text-foreground"
                      >
                        {m === "read_notes" && notesLoadingId === row.id
                          ? "Opening…"
                          : UPLOAD_MODE_LABELS[m]}
                      </button>
                    ))}
                  </div>
                )}

                {notesFor?.uploadId === row.id && (
                  <div className="mt-2 rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Notes — {notesFor.filename}
                      </div>
                      <button
                        type="button"
                        title="Close notes"
                        onClick={() => setNotesFor(null)}
                        className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {notesFor.notes.map((n) => (
                      <div key={n.id} className="space-y-1">
                        <div className="text-sm font-bold text-foreground">{n.title}</div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{n.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
