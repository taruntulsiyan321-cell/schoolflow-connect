import { useEffect, useRef, useState } from "react";
import {
  Megaphone, Plus, Edit2, Trash2, X, Save, Clock, Check, Paperclip, Calendar,
} from "lucide-react";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import {
  AttendanceService,
  AnnouncementService,
  useAcademicLive,
  type AssignedClass,
  type TeacherAnnouncementRow,
  type AnnouncementPriority,
  type AnnouncementStatus,
} from "@/academic";

const priorityColor = { normal: "#78788c", important: "#f59e0b", urgent: "#cc5069" };
const statusColor = { draft: "#46465a", published: "#10b981", scheduled: "#6366f1" };

type FormState = {
  title: string;
  body: string;
  classId: string;
  priority: AnnouncementPriority;
  status: AnnouncementStatus;
  scheduledFor: string;
};

function AnnouncementForm({
  initial,
  onSave,
  onCancel,
  classes,
  saving,
}: {
  initial?: Partial<TeacherAnnouncementRow>;
  onSave: (a: FormState) => void;
  onCancel: () => void;
  classes: AssignedClass[];
  saving?: boolean;
}) {
  const [form, setForm] = useState<FormState>({
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    classId: initial?.classId ?? classes[0]?.id ?? "",
    priority: initial?.priority ?? "normal",
    status: initial?.status ?? "draft",
    scheduledFor: initial?.scheduledFor ?? "",
  });

  return (
    <div className="bg-surface border border-[#3b5bdb]/20 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-foreground">{initial?.id ? "Edit Announcement" : "New Announcement"}</div>
        <button onClick={onCancel} type="button"><X className="w-4 h-4 text-muted-foreground" /></button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Title *</label>
          <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-[#3b5bdb]/40" />
        </div>

        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Message Body *</label>
          <textarea value={form.body} onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))} rows={4}
            className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-[#3b5bdb]/40 resize-none" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Target Class *</label>
          <select value={form.classId}
            onChange={(e) => setForm((p) => ({ ...p, classId: e.target.value }))}
            className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none">
            {classes.length === 0 && <option value="">No assigned classes</option>}
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name} {c.section}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Priority</label>
          <select value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value as AnnouncementPriority }))}
            className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none">
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Publish</label>
          <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as AnnouncementStatus }))}
            className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none">
            <option value="draft">Save as Draft</option>
            <option value="published">Publish Now</option>
            <option value="scheduled" disabled>Schedule (coming soon)</option>
          </select>
        </div>

        {form.status === "scheduled" && (
          <div className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] text-[10px] font-semibold">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            Scheduled publishing isn&apos;t available yet â€” this was saved before the feature existed and will stay as-is until you change it. Switch to Draft or Publish Now to update it.
          </div>
        )}

        <div className="col-span-2">
          <button type="button" disabled className="flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-semibold text-muted-foreground bg-muted cursor-not-allowed">
            <Paperclip className="w-3.5 h-3.5" /> Attachments coming soon
          </button>
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground bg-muted hover:bg-muted/80">Cancel</button>
        <button type="button" onClick={() => onSave(form)} disabled={!form.title || !form.body || !form.classId || saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all">
          <Save className="w-3.5 h-3.5" /> {saving ? "Savingâ€¦" : form.status === "draft" ? "Save Draft" : form.status === "scheduled" ? "Schedule" : "Publish"}
        </button>
      </div>
    </div>
  );
}

export default function Announcements() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["profile"]);
  const [classes, setClasses] = useState<AssignedClass[]>([]);
  const [items, setItems] = useState<TeacherAnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  };

  const reload = async (assigned: AssignedClass[]) => {
    if (!ctx) return;
    const rows = await AnnouncementService.listForTeacher(
      ctx,
      assigned.map((c) => c.id),
    );
    setItems(rows);
  };

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    const isFirst = !loadedRef.current;
    (async () => {
      if (isFirst) setLoading(true);
      setError(null);
      try {
        const assigned = await AttendanceService.listAssignedClasses(ctx);
        if (cancelled) return;
        setClasses(assigned);
        await reload(assigned);
        loadedRef.current = true;
      } catch (e) {
        if (!cancelled) {
          setClasses([]);
          setItems([]);
          setError(e instanceof Error ? e.message : "Could not load announcements");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, ctx?.schoolId, ctx?.userId, liveVersion]);

  async function handleCreate(form: FormState) {
    if (!ctx) return;
    setSaving(true);
    try {
      await AnnouncementService.create(ctx, {
        title: form.title,
        body: form.body,
        classId: form.classId,
        priority: form.priority,
        status: form.status,
        scheduledFor: form.scheduledFor || null,
      });
      await reload(classes);
      setCreating(false);
      showFlash(form.status === "published" ? "Announcement published" : form.status === "scheduled" ? "Announcement scheduled" : "Draft saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save announcement");
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(id: string, form: FormState) {
    if (!ctx) return;
    setSaving(true);
    try {
      await AnnouncementService.update(ctx, id, {
        title: form.title,
        body: form.body,
        classId: form.classId,
        priority: form.priority,
        status: form.status,
        scheduledFor: form.scheduledFor || null,
      });
      await reload(classes);
      setEditingId(null);
      showFlash("Announcement updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update announcement");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: string) {
    if (!ctx) return;
    if (!confirm("Remove this announcement?")) return;
    try {
      await AnnouncementService.remove(ctx, id);
      await reload(classes);
      showFlash("Announcement deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete announcement");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-foreground">Announcements</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Only for your assigned classes â€” not school-wide</div>
        </div>
        <button type="button" onClick={() => setCreating(true)} disabled={!classes.length}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all">
          <Plus className="w-3.5 h-3.5" /> New Announcement
        </button>
      </div>

      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#10b981]/15 border border-[#10b981]/25 text-[#10b981] text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-[#cc5069]/15 border border-[#cc5069]/25 text-[#cc5069] text-xs font-semibold">
          {error}
        </div>
      )}

      {creating && (
        <AnnouncementForm classes={classes} onSave={handleCreate} onCancel={() => setCreating(false)} saving={saving} />
      )}

      {loading ? (
        <div className="text-center py-12 text-xs text-muted-foreground">Loading announcementsâ€¦</div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id}>
              {editingId === a.id ? (
                <AnnouncementForm classes={classes} initial={a} onSave={(form) => handleEdit(a.id, form)} onCancel={() => setEditingId(null)} saving={saving} />
              ) : (
                <div className="bg-surface border border-border/70 rounded-2xl p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${priorityColor[a.priority]}18`, color: priorityColor[a.priority] }}>
                      <Megaphone className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-bold text-foreground">{a.title}</div>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize" style={{ background: `${statusColor[a.status]}18`, color: statusColor[a.status] }}>{a.status}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize" style={{ background: `${priorityColor[a.priority]}18`, color: priorityColor[a.priority] }}>{a.priority}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                        <span>{a.targetClass} {a.targetSection}</span>
                        {a.publishedAt && <span className="flex items-center gap-1"><Calendar className="w-2.5 h-2.5" /> {a.publishedAt}</span>}
                        {a.scheduledFor && <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Scheduled: {a.scheduledFor}</span>}
                        {a.hasAttachment && <span className="flex items-center gap-0.5 text-[#6366f1]"><Paperclip className="w-2.5 h-2.5" /> {a.attachmentName}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-2 leading-relaxed">{a.body}</div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button type="button" onClick={() => setEditingId(a.id)}
                        className="w-7 h-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center hover:bg-muted/80 hover:text-foreground transition-all">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => void deleteItem(a.id)}
                        className="w-7 h-7 rounded-lg bg-[#cc5069]/10 text-[#cc5069] flex items-center justify-center hover:bg-[#cc5069]/20 transition-all">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {items.length === 0 && !creating && (
            <div className="text-center py-12 text-xs text-muted-foreground">
              {classes.length === 0
                ? "No assigned classes yet â€” announcements appear once you teach a class."
                : "No announcements yet. Create your first announcement."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
