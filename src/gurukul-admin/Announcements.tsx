import { useState, useMemo } from "react";
import {
  Plus, Search, Filter, Download, Printer, Eye, Edit2, Trash2,
  Copy, Archive, RotateCcw, Send, Clock, ChevronDown, X,
  Bell, Users, GraduationCap, BookOpen, UserCheck, Calendar,
  AlertTriangle, Info, CheckCircle2, BarChart2, Globe, Tag,
} from "lucide-react";
import { cn, StatusBadge, ConfirmModal, UndoToast, useUndoDelete, exportCSV } from "./shared";
import { adminStudents, adminTeachers, adminParents, adminClasses } from "./data";

// ── Types ─────────────────────────────────────────────────────────────────────

type AnnouncementStatus = "draft" | "scheduled" | "published" | "archived" | "expired";
type Priority = "normal" | "important" | "urgent";
type AudienceType = "school" | "class" | "section" | "student" | "teacher" | "parent";

interface Audience {
  type: AudienceType;
  ids?: string[];
  label: string;
}

interface AnnouncementRecord {
  id: string;
  title: string;
  description: string;
  content: string;
  priority: Priority;
  status: AnnouncementStatus;
  audiences: Audience[];
  publishAt: string;
  expiresAt: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  attachments: string[];
  // delivery stats
  totalRecipients: number;
  delivered: number;
  read: number;
  failed: number;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const INITIAL: AnnouncementRecord[] = [
  { id: "an001", title: "July 2026 Exam Schedule Released", description: "Unit tests begin August 4th.", content: "Dear students and parents,\n\nPlease note that Unit Test 1 begins on August 4th, 2026. All students must carry their hall tickets. Absentees will not be granted re-tests without valid medical documentation.\n\nRegards,\nAdmin", priority: "urgent", status: "published", audiences: [{ type: "school", label: "Entire School" }], publishAt: "2026-07-24T09:00", expiresAt: "2026-08-10T00:00", author: "Super Admin", createdAt: "2026-07-24T08:45", updatedAt: "2026-07-24T09:00", attachments: ["exam_schedule_july2026.pdf"], totalRecipients: 497, delivered: 491, read: 378, failed: 6 },
  { id: "an002", title: "Parent-Teacher Meeting — Aug 2", description: "PTM scheduled for Saturday, August 2nd from 10 AM to 1 PM.", content: "Dear Parents,\n\nWe cordially invite you to the Parent-Teacher Meeting on Saturday, August 2nd, 2026 from 10:00 AM to 1:00 PM in the school auditorium.\n\nYour attendance is important for your child's academic progress.", priority: "important", status: "published", audiences: [{ type: "parent", label: "All Parents" }], publishAt: "2026-07-22T10:00", expiresAt: "2026-08-02T14:00", author: "Super Admin", createdAt: "2026-07-22T09:30", updatedAt: "2026-07-22T10:00", attachments: [], totalRecipients: 231, delivered: 229, read: 184, failed: 2 },
  { id: "an003", title: "New AI Coach Features Available", description: "Nova AI coach now supports voice Q&A.", content: "Dear Students,\n\nWe are excited to announce new features in the Nova AI Coach:\n• Voice-based Q&A\n• Personalised revision plans\n• Concept maps\n\nLog in to explore!", priority: "normal", status: "published", audiences: [{ type: "student", label: "All Students" }], publishAt: "2026-07-20T08:00", expiresAt: "2026-08-20T00:00", author: "Super Admin", createdAt: "2026-07-20T07:45", updatedAt: "2026-07-20T08:00", attachments: [], totalRecipients: 248, delivered: 245, read: 198, failed: 3 },
  { id: "an004", title: "Board Exam Registration Deadline", description: "All 12th grade students must submit exam forms by Aug 15.", content: "Attention Class 12 students:\n\nThe deadline for board exam form submission is August 15, 2026. Late submissions will not be accepted. Visit the admin office with required documents.", priority: "urgent", status: "scheduled", audiences: [{ type: "class", ids: ["c002"], label: "Class 12th" }], publishAt: "2026-07-28T07:00", expiresAt: "2026-08-15T00:00", author: "Super Admin", createdAt: "2026-07-26T10:00", updatedAt: "2026-07-26T10:00", attachments: ["registration_form.pdf"], totalRecipients: 122, delivered: 0, read: 0, failed: 0 },
  { id: "an005", title: "Library Closure Notice", description: "Library will remain closed July 27-29 for annual inventory.", content: "The school library will be closed from July 27 to July 29, 2026 for annual stock verification. Students may borrow books today before 4 PM.", priority: "normal", status: "draft", audiences: [{ type: "school", label: "Entire School" }], publishAt: "", expiresAt: "", author: "Super Admin", createdAt: "2026-07-26T09:00", updatedAt: "2026-07-26T09:00", attachments: [], totalRecipients: 0, delivered: 0, read: 0, failed: 0 },
  { id: "an006", title: "Annual Sports Day — Registration Open", description: "Register for Annual Sports Day events by July 20.", content: "Annual Sports Day registration is now open. All events close on July 20, 2026. Contact your class teacher to register.", priority: "normal", status: "archived", audiences: [{ type: "school", label: "Entire School" }], publishAt: "2026-07-01T08:00", expiresAt: "2026-07-20T00:00", author: "Super Admin", createdAt: "2026-07-01T07:00", updatedAt: "2026-07-20T01:00", attachments: [], totalRecipients: 497, delivered: 490, read: 423, failed: 7 },
  { id: "an007", title: "Holiday Notice — Independence Day", description: "School will remain closed on August 15.", content: "School will remain closed on Independence Day, August 15, 2026. Classes will resume on August 16.", priority: "normal", status: "expired", audiences: [{ type: "school", label: "Entire School" }], publishAt: "2026-07-10T08:00", expiresAt: "2026-07-15T00:00", author: "Super Admin", createdAt: "2026-07-10T07:30", updatedAt: "2026-07-10T08:00", attachments: [], totalRecipients: 497, delivered: 488, read: 401, failed: 9 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  normal: { label: "Normal", color: "#78788c", icon: <Info className="w-3.5 h-3.5" /> },
  important: { label: "Important", color: "#c08a3a", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  urgent: { label: "Urgent", color: "#cc5069", icon: <Bell className="w-3.5 h-3.5" /> },
};

const STATUS_TABS: { key: AnnouncementStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "scheduled", label: "Scheduled" },
  { key: "draft", label: "Drafts" },
  { key: "archived", label: "Archived" },
  { key: "expired", label: "Expired" },
];

function PriorityBadge({ priority }: { priority: Priority }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${cfg.color}20`, color: cfg.color }}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function DeliveryBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="text-[10px] text-[#78788c] w-16 shrink-0">{label}</div>
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-[10px] font-bold tabular-nums shrink-0" style={{ color }}>{value.toLocaleString()}</div>
    </div>
  );
}

// ── Compose / Edit Modal ──────────────────────────────────────────────────────

function ComposeModal({ announcement, onSave, onClose }: {
  announcement?: AnnouncementRecord;
  onSave: (a: AnnouncementRecord, action: "draft" | "publish" | "schedule") => void;
  onClose: () => void;
}) {
  const blank: AnnouncementRecord = {
    id: `an${Date.now()}`, title: "", description: "", content: "", priority: "normal",
    status: "draft", audiences: [], publishAt: "", expiresAt: "", author: "Super Admin",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    attachments: [], totalRecipients: 0, delivered: 0, read: 0, failed: 0,
  };
  const [form, setForm] = useState<AnnouncementRecord>(announcement ?? blank);
  const [audienceMode, setAudienceMode] = useState<AudienceType>("school");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = "Title is required";
    if (!form.content.trim()) e.content = "Content is required";
    if (form.audiences.length === 0) e.audience = "Select at least one audience";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function addAudience(type: AudienceType, ids?: string[], label?: string) {
    const entry: Audience = { type, ids, label: label ?? audienceLabels[type] };
    setForm((f) => ({ ...f, audiences: [...f.audiences.filter((a) => a.type !== type || ids), entry] }));
  }

  function removeAudience(idx: number) {
    setForm((f) => ({ ...f, audiences: f.audiences.filter((_, i) => i !== idx) }));
  }

  const audienceLabels: Record<AudienceType, string> = {
    school: "Entire School", class: "Specific Class", section: "Specific Section",
    student: "All Students", teacher: "All Teachers", parent: "All Parents",
  };

  function handleAction(action: "draft" | "publish" | "schedule") {
    if (action !== "draft" && !validate()) return;
    let status: AnnouncementStatus = action === "draft" ? "draft" : action === "schedule" ? "scheduled" : "published";
    if (action === "publish" && !form.audiences.length) { setErrors({ audience: "Select at least one audience" }); return; }
    const saved: AnnouncementRecord = { ...form, status, updatedAt: new Date().toISOString(), totalRecipients: calcRecipients(form.audiences) };
    onSave(saved, action);
  }

  function calcRecipients(audiences: Audience[]) {
    if (audiences.some((a) => a.type === "school")) return adminStudents.length + adminTeachers.length + adminParents.length;
    let count = 0;
    if (audiences.some((a) => a.type === "student")) count += adminStudents.length;
    if (audiences.some((a) => a.type === "teacher")) count += adminTeachers.length;
    if (audiences.some((a) => a.type === "parent")) count += adminParents.length;
    return count;
  }

  const f = (key: keyof AnnouncementRecord, label: string, type = "text", opts?: { value: string; label: string }[]) => (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">{label}</label>
      {opts ? (
        <select value={form[key] as string} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50">
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type={type} value={form[key] as string} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
          className={cn("bg-white/5 border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50",
            errors[key] ? "border-[#cc5069]/50" : "border-white/10")} />
      )}
      {errors[key] && <span className="text-[9px] text-[#cc5069]">{errors[key]}</span>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-[#0d0d0f] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-[#0d0d0f] border-b border-white/7 px-6 py-4 flex items-center justify-between z-10">
          <div className="text-sm font-bold text-white">{announcement ? "Edit Announcement" : "Compose Announcement"}</div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Title */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Title</label>
            <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Announcement title..."
              className={cn("bg-white/5 border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50", errors.title ? "border-[#cc5069]/50" : "border-white/10")} />
            {errors.title && <span className="text-[9px] text-[#cc5069]">{errors.title}</span>}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Short Description</label>
            <input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Brief summary..."
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50" />
          </div>

          {/* Content */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Content</label>
            <textarea value={form.content} onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))} rows={6} placeholder="Write announcement content..."
              className={cn("bg-white/5 border rounded-xl px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-[#6366f1]/50", errors.content ? "border-[#cc5069]/50" : "border-white/10")} />
            {errors.content && <span className="text-[9px] text-[#cc5069]">{errors.content}</span>}
          </div>

          {/* Priority + Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Priority</label>
              <select value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value as Priority }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50">
                <option value="normal">Normal</option>
                <option value="important">Important</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Schedule Publish At</label>
              <input type="datetime-local" value={form.publishAt} onChange={(e) => setForm((p) => ({ ...p, publishAt: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Expiry Date & Time</label>
              <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50" />
            </div>
          </div>

          {/* Audience */}
          <div className="flex flex-col gap-3">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Target Audience</label>
            {errors.audience && <span className="text-[9px] text-[#cc5069]">{errors.audience}</span>}

            <div className="flex flex-wrap gap-2">
              {([
                { type: "school" as AudienceType, label: "Entire School", icon: <Globe className="w-3.5 h-3.5" /> },
                { type: "student" as AudienceType, label: "All Students", icon: <GraduationCap className="w-3.5 h-3.5" /> },
                { type: "teacher" as AudienceType, label: "All Teachers", icon: <BookOpen className="w-3.5 h-3.5" /> },
                { type: "parent" as AudienceType, label: "All Parents", icon: <UserCheck className="w-3.5 h-3.5" /> },
              ]).map((opt) => {
                const active = form.audiences.some((a) => a.type === opt.type);
                return (
                  <button key={opt.type} onClick={() => active
                    ? setForm((p) => ({ ...p, audiences: p.audiences.filter((a) => a.type !== opt.type) }))
                    : addAudience(opt.type, undefined, opt.label)
                  }
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all",
                      active ? "bg-[#6366f1]/15 border-[#6366f1]/30 text-[#a5b4fc]" : "bg-white/5 border-white/10 text-[#78788c] hover:text-white")}>
                    {opt.icon} {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Class-specific targeting */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#46465a] uppercase tracking-wider">Specific Classes</label>
              <div className="flex flex-wrap gap-2">
                {adminClasses.map((cls) => {
                  const active = form.audiences.some((a) => a.type === "class" && a.ids?.includes(cls.id));
                  return (
                    <button key={cls.id} onClick={() => active
                      ? setForm((p) => ({ ...p, audiences: p.audiences.filter((a) => !(a.type === "class" && a.ids?.includes(cls.id))) }))
                      : addAudience("class", [cls.id], `Class ${cls.name}`)
                    }
                      className={cn("px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all",
                        active ? "bg-[#4b9fd4]/15 border-[#4b9fd4]/30 text-[#4b9fd4]" : "bg-white/5 border-white/10 text-[#78788c] hover:text-white")}>
                      Class {cls.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected audience display */}
            {form.audiences.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {form.audiences.map((a, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg bg-white/5 text-[#78788c]">
                    {a.label}
                    <button onClick={() => removeAudience(i)} className="hover:text-white"><X className="w-2.5 h-2.5" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Attachments placeholder */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Attachments</label>
            <div className="border border-dashed border-white/15 rounded-xl p-4 text-center text-xs text-[#46465a] hover:border-white/25 transition-all cursor-pointer">
              Click to attach files (PDF, Images, Documents)
            </div>
            {form.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {form.attachments.map((f, i) => (
                  <span key={i} className="text-[10px] px-2 py-1 rounded-lg bg-white/5 text-[#78788c] flex items-center gap-1">
                    {f} <button onClick={() => setForm((p) => ({ ...p, attachments: p.attachments.filter((_, j) => j !== i) }))} className="hover:text-white"><X className="w-2.5 h-2.5" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-[#0d0d0f] border-t border-white/7 px-6 py-4 flex flex-wrap gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
            Cancel
          </button>
          <button onClick={() => handleAction("draft")} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] border border-white/10 hover:text-white hover:bg-white/5 transition-all">
            Save as Draft
          </button>
          {form.publishAt && (
            <button onClick={() => handleAction("schedule")} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-[#4b9fd4] bg-[#4b9fd4]/10 hover:bg-[#4b9fd4]/20 transition-all">
              <Clock className="w-4 h-4" /> Schedule
            </button>
          )}
          <button onClick={() => handleAction("publish")} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">
            <Send className="w-4 h-4" /> Publish Now
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail View ───────────────────────────────────────────────────────────────

function AnnouncementDetail({ ann, onClose, onEdit }: { ann: AnnouncementRecord; onClose: () => void; onEdit: () => void }) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-96 sm:w-[440px] bg-[#0a0a0c] border-l border-white/7 flex flex-col h-full overflow-hidden">
        <div className="p-5 border-b border-white/7 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <PriorityBadge priority={ann.priority} />
              <StatusBadge status={ann.status} />
            </div>
            <div className="text-sm font-bold text-white mt-1">{ann.title}</div>
            <div className="text-[10px] text-[#78788c] mt-0.5">By {ann.author} · {new Date(ann.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
          </div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Content */}
          <div>
            <div className="text-[10px] text-[#46465a] uppercase tracking-wider mb-2">Content</div>
            <div className="text-sm text-[#c8c8d4] leading-relaxed whitespace-pre-wrap bg-white/3 rounded-xl p-4">{ann.content}</div>
          </div>

          {/* Audience */}
          <div>
            <div className="text-[10px] text-[#46465a] uppercase tracking-wider mb-2">Target Audience</div>
            <div className="flex flex-wrap gap-2">
              {ann.audiences.map((a, i) => (
                <span key={i} className="text-[10px] px-2.5 py-1 rounded-lg bg-[#6366f1]/10 text-[#a5b4fc]">{a.label}</span>
              ))}
            </div>
          </div>

          {/* Delivery stats */}
          {ann.status !== "draft" && ann.totalRecipients > 0 && (
            <div>
              <div className="text-[10px] text-[#46465a] uppercase tracking-wider mb-3">Delivery Analytics</div>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                  { label: "Recipients", value: ann.totalRecipients, color: "#6366f1" },
                  { label: "Delivered", value: ann.delivered, color: "#4b9fd4" },
                  { label: "Read", value: ann.read, color: "#4aa87a" },
                  { label: "Failed", value: ann.failed, color: "#cc5069" },
                ].map((stat) => (
                  <div key={stat.label} className="p-2 rounded-xl bg-white/3 text-center">
                    <div className="text-sm font-black tabular-nums" style={{ color: stat.color }}>{stat.value}</div>
                    <div className="text-[8px] text-[#78788c]">{stat.label}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <DeliveryBar label="Delivered" value={ann.delivered} total={ann.totalRecipients} color="#4b9fd4" />
                <DeliveryBar label="Read" value={ann.read} total={ann.totalRecipients} color="#4aa87a" />
                <DeliveryBar label="Unread" value={ann.delivered - ann.read} total={ann.totalRecipients} color="#c08a3a" />
                <DeliveryBar label="Failed" value={ann.failed} total={ann.totalRecipients} color="#cc5069" />
              </div>
            </div>
          )}

          {/* Dates */}
          <div className="space-y-2">
            {[
              { label: "Publish Date", value: ann.publishAt ? new Date(ann.publishAt).toLocaleString("en-IN") : "Immediate" },
              { label: "Expiry Date", value: ann.expiresAt ? new Date(ann.expiresAt).toLocaleString("en-IN") : "No expiry" },
              { label: "Last Updated", value: new Date(ann.updatedAt).toLocaleString("en-IN") },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/3">
                <div className="text-[9px] text-[#46465a] uppercase tracking-wider w-24 shrink-0">{row.label}</div>
                <div className="text-xs text-[#c8c8d4]">{row.value}</div>
              </div>
            ))}
          </div>

          {/* Attachments */}
          {ann.attachments.length > 0 && (
            <div>
              <div className="text-[10px] text-[#46465a] uppercase tracking-wider mb-2">Attachments</div>
              {ann.attachments.map((a, i) => (
                <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl bg-white/3 text-xs text-[#78788c]">
                  <Tag className="w-3.5 h-3.5" /> {a}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/7">
          <button onClick={onEdit} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">
            Edit Announcement
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AnnouncementManagement() {
  const [items, setItems] = useState<AnnouncementRecord[]>(INITIAL);
  const { toast, closeToast, softDelete } = useUndoDelete<AnnouncementRecord>(setItems);
  const [statusTab, setStatusTab] = useState<AnnouncementStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterAudience, setFilterAudience] = useState("all");
  const [compose, setCompose] = useState<AnnouncementRecord | "new" | null>(null);
  const [detail, setDetail] = useState<AnnouncementRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = items;
    if (statusTab !== "all") list = list.filter((a) => a.status === statusTab);
    if (search) list = list.filter((a) => a.title.toLowerCase().includes(search.toLowerCase()) || a.description.toLowerCase().includes(search.toLowerCase()));
    if (filterPriority !== "all") list = list.filter((a) => a.priority === filterPriority);
    if (filterAudience !== "all") list = list.filter((a) => a.audiences.some((au) => au.type === filterAudience));
    return [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [items, statusTab, search, filterPriority, filterAudience]);

  function handleSave(ann: AnnouncementRecord) {
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === ann.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = ann; return next; }
      return [ann, ...prev];
    });
    setCompose(null);
  }

  function handleDuplicate(ann: AnnouncementRecord) {
    const dup: AnnouncementRecord = { ...ann, id: `an${Date.now()}`, title: `Copy of ${ann.title}`, status: "draft", publishAt: "", expiresAt: "", totalRecipients: 0, delivered: 0, read: 0, failed: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setItems((prev) => [dup, ...prev]);
  }

  function handleArchive(id: string) {
    setItems((prev) => prev.map((a) => a.id === id ? { ...a, status: "archived" as AnnouncementStatus } : a));
  }

  function handleRestore(id: string) {
    setItems((prev) => prev.map((a) => a.id === id ? { ...a, status: "draft" as AnnouncementStatus } : a));
  }

  function handleDelete(id: string) {
    const item = items.find((x) => x.id === id);
    if (!item) return;
    softDelete([item], `"${item.title.slice(0, 30)}..." deleted`);
  }

  function handleExport() {
    exportCSV("announcements", filtered.map((a) => ({
      Title: a.title, Status: a.status, Priority: a.priority,
      Audience: a.audiences.map((au) => au.label).join("; "),
      PublishedAt: a.publishAt, ExpiresAt: a.expiresAt,
      Recipients: a.totalRecipients, Read: a.read, Author: a.author,
    })));
  }

  const tabCounts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    items.forEach((a) => { c[a.status] = (c[a.status] ?? 0) + 1; });
    return c;
  }, [items]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#46465a]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search announcements..."
            className="w-full bg-[#131316] border border-white/7 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#6366f1]/50" />
        </div>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}
          className="bg-[#131316] border border-white/7 rounded-xl px-3 py-2.5 text-sm text-[#78788c] focus:outline-none focus:border-[#6366f1]/50">
          <option value="all">All Priorities</option>
          <option value="normal">Normal</option>
          <option value="important">Important</option>
          <option value="urgent">Urgent</option>
        </select>
        <select value={filterAudience} onChange={(e) => setFilterAudience(e.target.value)}
          className="bg-[#131316] border border-white/7 rounded-xl px-3 py-2.5 text-sm text-[#78788c] focus:outline-none focus:border-[#6366f1]/50">
          <option value="all">All Audiences</option>
          <option value="school">Entire School</option>
          <option value="student">Students</option>
          <option value="teacher">Teachers</option>
          <option value="parent">Parents</option>
          <option value="class">Specific Class</option>
        </select>
        <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
          <Download className="w-3.5 h-3.5" /> Export
        </button>
        <button onClick={() => setCompose("new")} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">
          <Plus className="w-3.5 h-3.5" /> Compose
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 p-1 bg-[#131316] border border-white/7 rounded-2xl w-fit">
        {STATUS_TABS.map((tab) => (
          <button key={tab.key} onClick={() => setStatusTab(tab.key)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
              statusTab === tab.key ? "bg-[#6366f1]/15 text-[#6366f1]" : "text-[#78788c] hover:text-white")}>
            {tab.label}
            <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full",
              statusTab === tab.key ? "bg-[#6366f1]/20 text-[#a5b4fc]" : "bg-white/5 text-[#46465a]")}>
              {tabCounts[tab.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 bg-[#131316] border border-white/7 rounded-2xl">
            <Bell className="w-8 h-8 text-[#46465a]" />
            <div className="text-sm text-[#78788c]">No announcements found</div>
          </div>
        )}

        {filtered.map((ann) => (
          <div key={ann.id} className="bg-[#131316] border border-white/7 rounded-2xl p-4 hover:border-white/12 transition-all group">
            <div className="flex items-start gap-4">
              {/* Priority icon */}
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: `${PRIORITY_CONFIG[ann.priority].color}20`, color: PRIORITY_CONFIG[ann.priority].color }}>
                {PRIORITY_CONFIG[ann.priority].icon}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-bold text-white">{ann.title}</span>
                  <PriorityBadge priority={ann.priority} />
                  <StatusBadge status={ann.status} />
                </div>
                <div className="text-xs text-[#78788c] mb-2">{ann.description}</div>

                {/* Audience tags */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {ann.audiences.map((a, i) => (
                    <span key={i} className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-[#78788c]">{a.label}</span>
                  ))}
                </div>

                {/* Delivery mini-stats */}
                {ann.totalRecipients > 0 && (
                  <div className="flex items-center gap-4 text-[10px] text-[#78788c]">
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {ann.totalRecipients} recipients</span>
                    <span className="text-[#4aa87a]">{ann.read} read</span>
                    <span className="text-[#4b9fd4]">{ann.delivered} delivered</span>
                    {ann.failed > 0 && <span className="text-[#cc5069]">{ann.failed} failed</span>}
                  </div>
                )}
              </div>

              {/* Date + Actions */}
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="text-[10px] text-[#46465a]">
                  {ann.publishAt ? new Date(ann.publishAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Draft"}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setDetail(ann)} title="View" className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setCompose(ann)} title="Edit" className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDuplicate(ann)} title="Duplicate" className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {ann.status !== "archived" ? (
                    <button onClick={() => handleArchive(ann.id)} title="Archive" className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button onClick={() => handleRestore(ann.id)} title="Restore" className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-[#4aa87a] transition-all">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => setConfirmDelete(ann.id)} title="Delete" className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#cc5069]/20 flex items-center justify-center text-[#78788c] hover:text-[#cc5069] transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {compose !== null && (
        <ComposeModal
          announcement={compose === "new" ? undefined : compose}
          onSave={handleSave}
          onClose={() => setCompose(null)}
        />
      )}

      {detail && (
        <AnnouncementDetail
          ann={detail}
          onClose={() => setDetail(null)}
          onEdit={() => { setCompose(detail); setDetail(null); }}
        />
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        title="Delete announcement?"
        description="Are you sure you want to delete this announcement? You can undo this within 5 seconds."
        confirmLabel="Delete"
        danger
        onConfirm={() => { if (confirmDelete) handleDelete(confirmDelete); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {toast && <UndoToast state={toast} onClose={closeToast} />}
    </div>
  );
}
