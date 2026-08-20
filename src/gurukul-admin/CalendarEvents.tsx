import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  CalendarEventsService,
  type CalendarEvent,
  type CalendarEventType,
  type CalendarEventAudience,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "./shared";
import { toast } from "sonner";

const EVENT_TYPES: { value: CalendarEventType; label: string }[] = [
  { value: "holiday", label: "Holiday" },
  { value: "exam", label: "Exam" },
  { value: "meeting", label: "Meeting" },
  { value: "sports", label: "Sports" },
  { value: "cultural", label: "Cultural" },
  { value: "deadline", label: "Deadline" },
  { value: "other", label: "Other" },
];

const AUDIENCES: { value: CalendarEventAudience; label: string }[] = [
  { value: "all", label: "Whole school (all roles)" },
  { value: "students", label: "All students" },
  { value: "class", label: "One class" },
  { value: "teachers", label: "Teachers" },
  { value: "parents", label: "Parents" },
];

type ClassRow = { id: string; name: string; section: string | null };

type FormState = {
  id: string | null;
  title: string;
  description: string;
  eventType: CalendarEventType;
  audience: CalendarEventAudience;
  classId: string;
  date: string;
  allDay: boolean;
};

const EMPTY_FORM: FormState = {
  id: null, title: "", description: "", eventType: "holiday", audience: "all",
  classId: "", date: "", allDay: true,
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const inputCls = "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/60";

export default function CalendarEventsPage() {
  const { ctx, ready } = useAcademicContext();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    if (!ready || !ctx) return;
    setLoading(true);
    try {
      const list = await CalendarEventsService.listAll(ctx);
      setEvents(list);
      setError(null);
    } catch (e) {
      setEvents([]);
      setError(e instanceof Error ? e.message : "Failed to load calendar events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx]);

  useEffect(() => {
    supabase.from("classes").select("id, name, section").order("name").then(({ data }) => {
      setClasses((data ?? []) as ClassRow[]);
    });
  }, []);

  const grouped = useMemo(() => {
    const now = Date.now();
    const upcoming = events.filter((e) => new Date(e.startsAt).getTime() >= now);
    const past = events.filter((e) => new Date(e.startsAt).getTime() < now);
    return { upcoming, past };
  }, [events]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(ev: CalendarEvent) {
    setForm({
      id: ev.id,
      title: ev.title,
      description: ev.description ?? "",
      eventType: ev.eventType,
      audience: ev.audience,
      classId: ev.classId ?? "",
      date: ev.startsAt.slice(0, 10),
      allDay: ev.allDay,
    });
    setShowForm(true);
  }

  async function save() {
    if (!ctx) return;
    if (!form.title.trim() || !form.date) {
      toast.error("Title and date are required");
      return;
    }
    if (form.audience === "class" && !form.classId) {
      toast.error("Pick a class for a class-scoped event");
      return;
    }
    setSaving(true);
    try {
      const startsAt = new Date(`${form.date}T00:00:00`).toISOString();
      if (form.id) {
        await CalendarEventsService.update(ctx, form.id, {
          title: form.title,
          description: form.description || null,
          eventType: form.eventType,
          audience: form.audience,
          classId: form.audience === "class" ? form.classId : null,
          startsAt,
          allDay: form.allDay,
        });
        toast.success("Event updated");
      } else {
        await CalendarEventsService.create(ctx, {
          title: form.title,
          description: form.description || null,
          eventType: form.eventType,
          audience: form.audience,
          classId: form.audience === "class" ? form.classId : null,
          startsAt,
          allDay: form.allDay,
        });
        toast.success("Event added — students will see it via the calendar and Nova");
      }
      setShowForm(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save event");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!ctx) return;
    try {
      await CalendarEventsService.remove(ctx, id);
      toast.success("Event removed");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove event");
    }
  }

  function classLabel(id: string | null): string {
    if (!id) return "";
    const c = classes.find((x) => x.id === id);
    if (!c) return "";
    return c.section ? `${c.name} — ${c.section}` : c.name;
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <CalendarDays className="w-5 h-5" /> Academic Calendar
          </h1>
          <p className="text-sm text-white/50 mt-0.5">
            Holidays and school-wide events. Visible to every student in the school (or one class), including via Nova chat.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-3 py-2"
        >
          <Plus className="w-4 h-4" /> Add event
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm p-3">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-white/50 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <Section title="Upcoming" events={grouped.upcoming} onEdit={openEdit} onDelete={remove} classLabel={classLabel} />
          {grouped.past.length > 0 && (
            <Section title="Past" events={grouped.past} onEdit={openEdit} onDelete={remove} classLabel={classLabel} muted />
          )}
          {events.length === 0 && (
            <p className="text-white/40 text-sm text-center py-8">No calendar events yet. Add the first one above.</p>
          )}
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowForm(false)}>
          <div
            className="w-full max-w-md rounded-2xl bg-[#16161a] border border-white/10 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">{form.id ? "Edit event" : "Add event"}</h2>
              <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <input className={inputCls} placeholder="Title (e.g. Gandhi Jayanti)" value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              <textarea className={cn(inputCls, "resize-none")} rows={2} placeholder="Description (optional)" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <select className={inputCls} value={form.eventType}
                  onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value as CalendarEventType }))}>
                  {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <input type="date" className={inputCls} value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <select className={inputCls} value={form.audience}
                onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as CalendarEventAudience }))}>
                {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
              {form.audience === "class" && (
                <select className={inputCls} value={form.classId}
                  onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))}>
                  <option value="">Pick a class…</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.section ? `${c.name} — ${c.section}` : c.name}</option>
                  ))}
                </select>
              )}
              <button
                onClick={save}
                disabled={saving}
                className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 mt-1"
              >
                {saving ? "Saving…" : form.id ? "Save changes" : "Add event"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title, events, onEdit, onDelete, classLabel, muted,
}: {
  title: string;
  events: CalendarEvent[];
  onEdit: (e: CalendarEvent) => void;
  onDelete: (id: string) => void;
  classLabel: (id: string | null) => string;
  muted?: boolean;
}) {
  if (!events.length) return null;
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">{title}</h3>
      <div className="space-y-2">
        {events.map((e) => (
          <div
            key={e.id}
            className={cn(
              "flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3",
              muted && "opacity-50",
            )}
          >
            <button className="flex-1 text-left" onClick={() => onEdit(e)}>
              <div className="text-sm text-white font-medium">{e.title}</div>
              <div className="text-xs text-white/40 mt-0.5">
                {fmtDate(e.startsAt)} · {e.eventType} · {e.audience === "class" ? classLabel(e.classId) || "class" : e.audience}
              </div>
            </button>
            <button onClick={() => onDelete(e.id)} className="text-white/30 hover:text-red-400 shrink-0">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
