import { useState } from "react";
import {
  Megaphone, Plus, Edit2, Trash2, X, Save, Clock, Check, Paperclip, Calendar,
} from "lucide-react";
import { teacherAnnouncements, assignedClasses, type TeacherAnnouncement } from "./data";

const priorityColor = { normal: "#78788c", important: "#f59e0b", urgent: "#cc5069" };
const statusColor = { draft: "#46465a", published: "#10b981", scheduled: "#6366f1" };

function AnnouncementForm({ initial, onSave, onCancel }: {
  initial?: Partial<TeacherAnnouncement>;
  onSave: (a: Partial<TeacherAnnouncement>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    targetClass: initial?.targetClass ?? assignedClasses[0]?.className ?? "",
    targetSection: initial?.targetSection ?? assignedClasses[0]?.section ?? "",
    priority: initial?.priority ?? "normal" as TeacherAnnouncement["priority"],
    status: initial?.status ?? "draft" as TeacherAnnouncement["status"],
    scheduledFor: initial?.scheduledFor ?? "",
  });

  const availableClasses = assignedClasses.map((c) => ({ label: `${c.className} ${c.section}`, className: c.className, section: c.section }));

  return (
    <div className="bg-[#131316] border border-[#f59e0b]/20 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-white">{initial?.id ? "Edit Announcement" : "New Announcement"}</div>
        <button onClick={onCancel}><X className="w-4 h-4 text-[#78788c]" /></button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Title *</label>
          <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#f59e0b]/40" />
        </div>

        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Message Body *</label>
          <textarea value={form.body} onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))} rows={4}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#f59e0b]/40 resize-none" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Target Class *</label>
          <select value={`${form.targetClass}|${form.targetSection}`}
            onChange={(e) => {
              const [cls, sec] = e.target.value.split("|");
              setForm((p) => ({ ...p, targetClass: cls ?? "", targetSection: sec ?? "" }));
            }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
            {availableClasses.map((ac) => (
              <option key={`${ac.className}|${ac.section}`} value={`${ac.className}|${ac.section}`}>{ac.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Priority</label>
          <select value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value as TeacherAnnouncement["priority"] }))}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Publish</label>
          <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as TeacherAnnouncement["status"] }))}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
            <option value="draft">Save as Draft</option>
            <option value="published">Publish Now</option>
            <option value="scheduled">Schedule</option>
          </select>
        </div>

        {form.status === "scheduled" && (
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Schedule For</label>
            <input type="datetime-local" value={form.scheduledFor} onChange={(e) => setForm((p) => ({ ...p, scheduledFor: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#f59e0b]/40" />
          </div>
        )}

        <div className="col-span-2">
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-semibold text-[#78788c] bg-white/5 hover:bg-white/10 transition-all">
            <Paperclip className="w-3.5 h-3.5" /> Attach File (Image / PDF / Document)
          </button>
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10">Cancel</button>
        <button onClick={() => onSave(form)} disabled={!form.title || !form.body}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-black bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-40 transition-all">
          <Save className="w-3.5 h-3.5" /> {form.status === "draft" ? "Save Draft" : form.status === "scheduled" ? "Schedule" : "Publish"}
        </button>
      </div>
    </div>
  );
}

export default function Announcements() {
  const [items, setItems] = useState<TeacherAnnouncement[]>(teacherAnnouncements);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }

  function handleCreate(form: Partial<TeacherAnnouncement>) {
    const newA: TeacherAnnouncement = {
      id: `ta_${Date.now()}`,
      title: form.title ?? "",
      body: form.body ?? "",
      targetClass: form.targetClass ?? "",
      targetSection: form.targetSection ?? "",
      priority: form.priority ?? "normal",
      status: form.status ?? "draft",
      scheduledFor: form.scheduledFor,
      publishedAt: form.status === "published" ? new Date().toISOString().split("T")[0] : undefined,
      hasAttachment: false,
    };
    setItems((prev) => [newA, ...prev]);
    setCreating(false);
    showFlash(form.status === "published" ? "Announcement published" : form.status === "scheduled" ? "Announcement scheduled" : "Draft saved");
  }

  function handleEdit(id: string, form: Partial<TeacherAnnouncement>) {
    setItems((prev) => prev.map((a) => a.id !== id ? a : { ...a, ...form }));
    setEditingId(null);
    showFlash("Announcement updated");
  }

  function deleteItem(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id));
    showFlash("Announcement deleted");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-white">Announcements</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Only for your assigned classes — not school-wide</div>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-black bg-[#f59e0b] hover:bg-[#d97706] transition-all">
          <Plus className="w-3.5 h-3.5" /> New Announcement
        </button>
      </div>

      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#10b981]/15 border border-[#10b981]/25 text-[#10b981] text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}

      {creating && (
        <AnnouncementForm onSave={handleCreate} onCancel={() => setCreating(false)} />
      )}

      <div className="space-y-3">
        {items.map((a) => (
          <div key={a.id}>
            {editingId === a.id ? (
              <AnnouncementForm initial={a} onSave={(form) => handleEdit(a.id, form)} onCancel={() => setEditingId(null)} />
            ) : (
              <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${priorityColor[a.priority]}18`, color: priorityColor[a.priority] }}>
                    <Megaphone className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-sm font-bold text-white">{a.title}</div>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize" style={{ background: `${statusColor[a.status]}18`, color: statusColor[a.status] }}>{a.status}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize" style={{ background: `${priorityColor[a.priority]}18`, color: priorityColor[a.priority] }}>{a.priority}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-[#78788c]">
                      <span>{a.targetClass} {a.targetSection}</span>
                      {a.publishedAt && <span className="flex items-center gap-1"><Calendar className="w-2.5 h-2.5" /> {a.publishedAt}</span>}
                      {a.scheduledFor && <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Scheduled: {a.scheduledFor}</span>}
                      {a.hasAttachment && <span className="flex items-center gap-0.5 text-[#6366f1]"><Paperclip className="w-2.5 h-2.5" /> {a.attachmentName}</span>}
                    </div>
                    <div className="text-xs text-[#b0b0c0] mt-2 leading-relaxed">{a.body}</div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => setEditingId(a.id)}
                      className="w-7 h-7 rounded-lg bg-white/5 text-[#78788c] flex items-center justify-center hover:bg-white/10 hover:text-white transition-all">
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button onClick={() => deleteItem(a.id)}
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
          <div className="text-center py-12 text-xs text-[#46465a]">No announcements yet. Create your first announcement.</div>
        )}
      </div>
    </div>
  );
}
