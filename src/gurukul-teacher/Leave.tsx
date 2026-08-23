import { useEffect, useRef, useState } from "react";
import { Plus, Calendar, Check, Clock, X, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { LeaveService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toast } from "sonner";

const statusColor = { pending: "#f59e0b", approved: "#10b981", rejected: "#cc5069" };
const statusIcon = {
  pending: <Clock className="w-3.5 h-3.5" />,
  approved: <CheckCircle className="w-3.5 h-3.5" />,
  rejected: <XCircle className="w-3.5 h-3.5" />,
};

const leaveTypes = ["casual", "sick", "earned", "emergency", "other"] as const;

type UiLeave = {
  id: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  appliedAt: string;
  adminRemarks?: string;
};

function dayCount(from: string, to: string) {
  const a = new Date(from);
  const b = new Date(to);
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

export default function Leave() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["profile"]);
  const [requests, setRequests] = useState<UiLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const [form, setForm] = useState({
    leaveType: "casual" as (typeof leaveTypes)[number],
    fromDate: "",
    toDate: "",
    reason: "",
  });

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    const isFirst = !loadedRef.current;
    (async () => {
      if (isFirst) setLoading(true);
      setError(null);
      try {
        const rows = await LeaveService.listMine(ctx);
        if (cancelled) return;
        setRequests(
          rows.map((r) => ({
            id: r.id,
            leaveType: r.leaveType,
            fromDate: r.fromDate,
            toDate: r.toDate,
            days: dayCount(r.fromDate, r.toDate),
            reason: r.reason ?? "",
            status: r.status,
            appliedAt: r.createdAt.slice(0, 10),
          })),
        );
        loadedRef.current = true;
      } catch (e) {
        if (!cancelled) {
          setRequests([]);
          setError(e instanceof Error ? e.message : "Could not load leave requests");
          toast.error(e instanceof Error ? e.message : "Could not load leave requests");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  async function applyLeave() {
    if (!ctx || !form.fromDate || !form.toDate || !form.reason || saving) return;
    setSaving(true);
    try {
      await LeaveService.submit(ctx, {
        leaveType: form.leaveType,
        fromDate: form.fromDate,
        toDate: form.toDate,
        reason: form.reason.trim(),
        applicantKind: "teacher",
      });
      const rows = await LeaveService.listMine(ctx);
      setRequests(
        rows.map((r) => ({
          id: r.id,
          leaveType: r.leaveType,
          fromDate: r.fromDate,
          toDate: r.toDate,
          days: dayCount(r.fromDate, r.toDate),
          reason: r.reason ?? "",
          status: r.status,
          appliedAt: r.createdAt.slice(0, 10),
        })),
      );
      setApplying(false);
      setForm({ leaveType: "casual", fromDate: "", toDate: "", reason: "" });
      showFlash("Leave application submitted successfully");
      toast.success("Leave application submitted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit leave");
    } finally {
      setSaving(false);
    }
  }

  const approved = requests.filter((r) => r.status === "approved").reduce((s, r) => s + r.days, 0);
  const pending = requests.filter((r) => r.status === "pending").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading leaveâ€¦
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface border border-border/70 rounded-2xl p-4 text-center">
          <div className="text-xl font-black text-[#10b981]">{approved}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Days Approved</div>
        </div>
        <div className="bg-surface border border-border/70 rounded-2xl p-4 text-center">
          <div className="text-xl font-black text-[#3b5bdb]">{pending}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Pending Requests</div>
        </div>
        <div className="bg-surface border border-border/70 rounded-2xl p-4 text-center">
          <div className="text-xl font-black text-foreground">{requests.length}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Total Applications</div>
        </div>
      </div>

      {error && <div className="text-xs text-[#cc5069]">{error}</div>}

      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#10b981]/15 border border-[#10b981]/25 text-[#10b981] text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}

      {!applying && (
        <button
          type="button"
          onClick={() => setApplying(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] transition-all"
        >
          <Plus className="w-4 h-4" /> Apply for Leave
        </button>
      )}

      {applying && (
        <div className="bg-surface border border-[#3b5bdb]/20 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-foreground">Apply for Leave</div>
            <button type="button" onClick={() => setApplying(false)}>
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Leave Type</label>
              <select
                value={form.leaveType}
                onChange={(e) =>
                  setForm((p) => ({ ...p, leaveType: e.target.value as (typeof leaveTypes)[number] }))
                }
                className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none"
              >
                {leaveTypes.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)} Leave
                  </option>
                ))}
              </select>
            </div>
            <div />
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">From Date *</label>
              <input
                type="date"
                value={form.fromDate}
                onChange={(e) => setForm((p) => ({ ...p, fromDate: e.target.value }))}
                className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-[#3b5bdb]/40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">To Date *</label>
              <input
                type="date"
                value={form.toDate}
                min={form.fromDate}
                onChange={(e) => setForm((p) => ({ ...p, toDate: e.target.value }))}
                className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-[#3b5bdb]/40"
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Reason *</label>
              <textarea
                value={form.reason}
                onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                rows={3}
                className="bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-[#3b5bdb]/40 resize-none"
              />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setApplying(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground bg-muted hover:bg-muted/80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void applyLeave()}
              disabled={!form.fromDate || !form.toDate || !form.reason || saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Submit
              Application
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Leave History</div>
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="bg-surface border border-border/70 rounded-2xl p-4 flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${statusColor[r.status]}18`, color: statusColor[r.status] }}
              >
                {statusIcon[r.status]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs font-bold text-foreground capitalize">{r.leaveType} Leave</div>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize"
                    style={{ background: `${statusColor[r.status]}18`, color: statusColor[r.status] }}
                  >
                    {r.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-2.5 h-2.5" /> {r.fromDate} â†’ {r.toDate}
                  </span>
                  <span>
                    {r.days} day{r.days !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="text-[10px] text-[#b0b0c0] mt-1.5 leading-relaxed">{r.reason}</div>
              </div>
              <div className="text-[9px] text-muted-foreground shrink-0">Applied: {r.appliedAt}</div>
            </div>
          ))}
          {requests.length === 0 && (
            <div className="text-center py-10 text-xs text-muted-foreground">No leave applications found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
