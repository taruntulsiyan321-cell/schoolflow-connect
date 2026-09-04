/**
 * Teacher Resources — §10.11.
 *
 * Upload study material to a class you teach, see what you have uploaded, and
 * delete your own. Teacher-only by spec ("Uploaded by teachers only — not
 * admin, not principal"), which is also what the live policies enforce:
 * resources_write/update/delete all require has_role(auth.uid(),'teacher') and
 * teacher_teaches_class(auth.uid(), class_id), and probe4 measures admin,
 * student and parent being refused.
 *
 * §10.11 also says "No view tracking of any kind. Not who opened it, not a
 * view count." — so this screen deliberately shows no opens, no counts, and
 * records nothing when a resource is used.
 *
 * Delete is permanent: "Deletable by the uploader. Permanent deletion — no
 * trash." There is no restore, and resources are excluded from the trash
 * registry.
 */
import { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, Trash2, X, Save, FileUp, Link2, ExternalLink } from "lucide-react";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import {
  ResourceService,
  RESOURCE_KINDS,
  type AssignedClass,
  type LearningResourceRow,
  type ResourceKind,
} from "@/academic";
import {
  ACADEMIC_FILE_ACCEPT,
  publicAcademicFileUrl,
} from "@/academic/storage/academicFileUpload";
import { toErrorMessage } from "@/lib/presentation";

const KIND_LABEL: Record<ResourceKind, string> = {
  pdf: "PDF",
  image: "Image",
  video: "Video",
  link: "Link",
  notes: "Notes",
  worksheet: "Worksheet",
  presentation: "Presentation",
  other: "Other",
};

/** Kinds that are a pasted address rather than an uploaded file. */
const LINK_KINDS = new Set<ResourceKind>(["link", "video"]);

type FormState = {
  title: string;
  classId: string;
  resourceType: ResourceKind | "";
  subject: string;
  description: string;
  url: string;
  file: File | null;
};

const EMPTY_FORM: FormState = {
  title: "",
  classId: "",
  // No default kind, matching the column: resource_type is NOT NULL with no
  // DEFAULT precisely so a form cannot omit it and silently produce a 'link'.
  resourceType: "",
  subject: "",
  description: "",
  url: "",
  file: null,
};

function ResourceForm({
  classes,
  onSave,
  onCancel,
  saving,
}: {
  classes: AssignedClass[];
  onSave: (f: FormState) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const [form, setForm] = useState<FormState>({
    ...EMPTY_FORM,
    classId: classes[0]?.id ?? "",
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const isLink = form.resourceType !== "" && LINK_KINDS.has(form.resourceType);
  const hasBody = isLink ? form.url.trim() !== "" : form.file != null;
  const canSave =
    form.title.trim() !== "" && form.classId !== "" && form.resourceType !== "" && hasBody;

  return (
    <div className="bg-surface border border-[#3b5bdb]/20 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-foreground">New Resource</div>
        <button onClick={onCancel} type="button">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
            Title *
          </label>
          <input
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-[#3b5bdb]/40"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
            Class *
          </label>
          <select
            value={form.classId}
            onChange={(e) => setForm((p) => ({ ...p, classId: e.target.value }))}
            className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none"
          >
            {classes.length === 0 && <option value="">No assigned classes</option>}
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? "Unnamed"} {c.section ?? ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
            Type *
          </label>
          <select
            value={form.resourceType}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                resourceType: e.target.value as ResourceKind | "",
                // Switching between a link kind and a file kind clears the
                // half that no longer applies, so a stale file cannot be sent
                // with a link row or vice versa.
                url: "",
                file: null,
              }))
            }
            className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none"
          >
            <option value="">Choose a type…</option>
            {RESOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
            Subject
          </label>
          <input
            value={form.subject}
            onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
            className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-[#3b5bdb]/40"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
            {isLink ? "Link *" : "File *"}
          </label>
          {isLink ? (
            <input
              value={form.url}
              onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
              placeholder="https://…"
              className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-[#3b5bdb]/40"
            />
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept={ACADEMIC_FILE_ACCEPT}
                className="hidden"
                onChange={(e) => setForm((p) => ({ ...p, file: e.target.files?.[0] ?? null }))}
              />
              <button
                type="button"
                disabled={form.resourceType === ""}
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-foreground bg-muted hover:bg-muted/80 disabled:opacity-40"
              >
                <FileUp className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{form.file?.name ?? "Choose a file"}</span>
              </button>
            </>
          )}
        </div>

        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
            Description
          </label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            rows={3}
            className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-[#3b5bdb]/40 resize-none"
          />
        </div>

        <div className="col-span-2 text-[10px] text-muted-foreground">
          {isLink
            ? "Pasted links are stored as-is."
            : "PDF · Images · Word · Excel · PowerPoint · up to 20 MB"}
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground bg-muted hover:bg-muted/80"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(form)}
          disabled={!canSave || saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all"
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Publishing…" : "Publish"}
        </button>
      </div>
    </div>
  );
}

export default function Resources() {
  const { ctx, ready } = useAcademicContext();
  const [classes, setClasses] = useState<AssignedClass[]>([]);
  const [items, setItems] = useState<LearningResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** "" means every class this teacher teaches. */
  const [classFilter, setClassFilter] = useState<string>("");
  const loadedRef = useRef(false);

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  };

  const reload = async () => {
    if (!ctx) return;
    setItems(await ResourceService.listForTeacher(ctx, { classId: classFilter || null }));
  };

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    const isFirst = !loadedRef.current;
    (async () => {
      if (isFirst) setLoading(true);
      setError(null);
      try {
        // The class list only needs fetching once; the filter re-runs the rows.
        let assigned = classes;
        if (!loadedRef.current) {
          assigned = await ResourceService.listTeachableClasses(ctx);
          if (cancelled) return;
          setClasses(assigned);
        }
        const rows = await ResourceService.listForTeacher(ctx, {
          classId: classFilter || null,
        });
        if (cancelled) return;
        setItems(rows);
        loadedRef.current = true;
      } catch (e) {
        if (!cancelled) {
          setItems([]);
          setError(toErrorMessage(e, "Could not load resources"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // ctx is a fresh object on every render, so depending on it would refetch
    // in a loop; the ids and the filter are what actually decide the query.
    // Same shape as the sibling teacher screens (Announcements.tsx:179).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx?.schoolId, ctx?.userId, classFilter]);

  async function handleCreate(form: FormState) {
    if (!ctx || form.resourceType === "") return;
    setSaving(true);
    setError(null);
    try {
      await ResourceService.create(ctx, {
        classId: form.classId,
        title: form.title,
        resourceType: form.resourceType,
        subject: form.subject || null,
        description: form.description || null,
        file: form.file,
        url: form.url || null,
      });
      await reload();
      setCreating(false);
      showFlash("Resource published");
    } catch (e) {
      setError(toErrorMessage(e, "Could not publish the resource"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: string) {
    if (!ctx) return;
    // Permanent by spec — say so rather than implying a trash it can be pulled from.
    if (!confirm("Delete this resource permanently? It cannot be restored.")) return;
    try {
      await ResourceService.remove(ctx, id);
      await reload();
      showFlash("Resource deleted");
    } catch (e) {
      setError(toErrorMessage(e, "Could not delete the resource"));
    }
  }

  function classLabel(classId: string | null): string {
    if (!classId) return "No class";
    const c = classes.find((x) => x.id === classId);
    return c ? `${c.name ?? "Unnamed"} ${c.section ?? ""}`.trim() : "Another class";
  }

  function openResource(r: LearningResourceRow) {
    const href = r.url || (r.storagePath ? publicAcademicFileUrl(r.storagePath) : null);
    if (!href) {
      setError("That resource has no file or link attached.");
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-foreground flex items-center gap-2">
            <FolderOpen className="w-4 h-4" /> Resources
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Study material for the classes you teach. Students see it in their library.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {classes.length > 1 && (
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              aria-label="Filter by class"
              className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none"
            >
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? "Unnamed"} {c.section ?? ""}
                </option>
              ))}
            </select>
          )}
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={classes.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> New Resource
            </button>
          )}
        </div>
      </div>

      {flash && (
        <div className="px-3 py-2 rounded-xl bg-[#10b981]/10 text-[#10b981] text-[11px] font-semibold">
          {flash}
        </div>
      )}
      {error && (
        <div className="px-3 py-2 rounded-xl bg-[#cc5069]/10 text-[#cc5069] text-[11px] font-semibold">
          {error}
        </div>
      )}

      {creating && (
        <ResourceForm
          classes={classes}
          saving={saving}
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading ? (
        <div className="text-xs text-muted-foreground py-10 text-center">Loading resources…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-10 text-center">
          {classes.length === 0
            ? "You have no assigned classes, so there is nowhere to upload yet."
            : classFilter
              ? `You have not uploaded anything for ${classLabel(classFilter)} yet.`
              : "You have not uploaded anything yet."}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <div
              key={r.id}
              className="bg-surface border border-border rounded-2xl p-4 flex items-start justify-between gap-3"
            >
              <button
                type="button"
                onClick={() => openResource(r)}
                className="flex-1 text-left min-w-0"
              >
                <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <span className="truncate">{r.title}</span>
                  {r.url ? (
                    <Link2 className="w-3 h-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground" />
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 flex flex-wrap gap-x-2">
                  <span>{r.type}</span>
                  <span>·</span>
                  <span>{classLabel(r.classId)}</span>
                  {r.subject && (
                    <>
                      <span>·</span>
                      <span>{r.subject}</span>
                    </>
                  )}
                </div>
                {r.description && (
                  <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                    {r.description}
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={() => deleteItem(r.id)}
                title="Delete permanently"
                className="p-2 rounded-xl text-[#cc5069] hover:bg-[#cc5069]/10 shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
