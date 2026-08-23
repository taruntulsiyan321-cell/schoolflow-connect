import { useRef, useState } from "react";
import {
  FileText,
  FileImage,
  FileSpreadsheet,
  Presentation,
  Link2,
  File,
  Download,
  X,
  Loader2,
  Plus,
  Paperclip,
} from "lucide-react";
import type { HomeworkAttachmentMeta } from "@/academic/repository/homeworkRepository";
import {
  ACADEMIC_FILE_ACCEPT,
  attachmentFromLink,
  fileKindFromName,
  formatFileSize,
  uploadAcademicFile,
} from "@/academic/storage/academicFileUpload";
import { cn } from "@/gurukul-teacher/shared";
import { toErrorMessage } from "@/lib/presentation";

function KindIcon({ kind }: { kind: ReturnType<typeof fileKindFromName> }) {
  const cls = "w-4 h-4 shrink-0";
  switch (kind) {
    case "pdf":
      return <FileText className={cls} style={{ color: "#cc5069" }} />;
    case "image":
      return <FileImage className={cls} style={{ color: "#3b5bdb" }} />;
    case "sheet":
      return <FileSpreadsheet className={cls} style={{ color: "#10b981" }} />;
    case "slides":
      return <Presentation className={cls} style={{ color: "#f59e0b" }} />;
    case "link":
      return <Link2 className={cls} style={{ color: "#6366f1" }} />;
    case "doc":
      return <FileText className={cls} style={{ color: "#3b5bdb" }} />;
    default:
      return <File className={cls} style={{ color: "#78788c" }} />;
  }
}

export function AttachmentList({
  items,
  onRemove,
  emptyLabel = "No attachments",
  dense,
}: {
  items: HomeworkAttachmentMeta[];
  onRemove?: (index: number) => void;
  emptyLabel?: string;
  dense?: boolean;
}) {
  if (!items.length) {
    return <div className="text-[10px] text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div className={cn("space-y-1.5", dense && "space-y-1")}>
      {items.map((a, i) => {
        const kind = fileKindFromName(a.name, a.mimeType);
        const size = formatFileSize(a.sizeBytes);
        const isImage = kind === "image";
        return (
          <div
            key={`${a.url}-${i}`}
            className="flex items-center gap-2 p-2 rounded-xl bg-muted border border-border"
          >
            {isImage ? (
              <a href={a.url} target="_blank" rel="noreferrer" className="shrink-0">
                <img
                  src={a.url}
                  alt=""
                  className="w-10 h-10 rounded-lg object-cover border border-border"
                />
              </a>
            ) : (
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <KindIcon kind={kind} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-foreground truncate">{a.name}</div>
              <div className="text-[9px] text-muted-foreground">
                {size || (kind === "link" ? "Link" : kind.toUpperCase())}
              </div>
            </div>
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80"
              title="Open / download"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="Remove"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AttachmentComposer({
  items,
  onChange,
  disabled,
}: {
  items: HomeworkAttachmentMeta[];
  onChange: (next: HomeworkAttachmentMeta[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || disabled) return;
    setUploading(true);
    setError(null);
    // Commit each successful upload to state as it finishes, and keep going
    // on a per-file failure — a bad file later in the batch must not erase
    // (or block) files that already uploaded fine.
    let current = items;
    const failures: string[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          const meta = await uploadAcademicFile(file);
          current = [...current, meta];
          onChange(current);
        } catch (e) {
          failures.push(`${file.name} (${toErrorMessage(e, "upload failed")})`);
        }
      }
      if (failures.length) {
        setError(`Failed to upload: ${failures.join(", ")}`);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const addLink = () => {
    setError(null);
    try {
      const meta = attachmentFromLink(linkUrl, linkName);
      onChange([...items, meta]);
      setLinkUrl("");
      setLinkName("");
    } catch (e) {
      setError(toErrorMessage(e, "Invalid link"));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#3b5bdb]/15 text-[#3b5bdb] disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
          {uploading ? "Uploading…" : "Upload files"}
        </button>
        <span className="text-[9px] text-muted-foreground">
          PDF · Images · Word · Excel · PowerPoint · up to 20 MB
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACADEMIC_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => void addFiles(e.target.files)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={linkName}
          onChange={(e) => setLinkName(e.target.value)}
          disabled={disabled}
          placeholder="Link label (optional)"
          className="flex-1 min-w-[120px] bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground"
        />
        <input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          disabled={disabled}
          placeholder="https://… paste a link"
          className="flex-[2] min-w-[160px] bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground"
        />
        <button
          type="button"
          disabled={disabled || !linkUrl.trim()}
          onClick={addLink}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-[10px] font-bold bg-muted text-muted-foreground disabled:opacity-40"
        >
          <Plus className="w-3 h-3" /> Add link
        </button>
      </div>

      {error && <div className="text-[10px] text-destructive">{error}</div>}
      <AttachmentList
        items={items}
        onRemove={disabled ? undefined : (i) => onChange(items.filter((_, idx) => idx !== i))}
        emptyLabel="No files or links attached yet"
      />
    </div>
  );
}