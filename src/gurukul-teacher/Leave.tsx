import { useState } from "react";
import { Plus, Calendar, Check, Clock, X, CheckCircle, XCircle } from "lucide-react";
import { leaveRequests, type LeaveRequest } from "./data";

const statusColor = { pending: "#f59e0b", approved: "#10b981", rejected: "#cc5069" };
const statusIcon = {
  pending: <Clock className="w-3.5 h-3.5" />,
  approved: <CheckCircle className="w-3.5 h-3.5" />,
  rejected: <XCircle className="w-3.5 h-3.5" />,
};

const leaveTypes = ["casual", "sick", "earned", "emergency", "other"] as const;

export default function Leave() {
  const [requests, setRequests] = useState<LeaveRequest[]>(leaveRequests);
  const [applying, setApplying] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [form, setForm] = useState({
    leaveType: "casual" as LeaveRequest["leaveType"],
    fromDate: "",
    toDate: "",
    reason: "",
  });

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }

  function applyLeave() {
    if (!form.fromDate || !form.toDate || !form.reason) return;
    const from = new Date(form.fromDate);
    const to = new Date(form.toDate);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const newReq: LeaveRequest = {
      id: `l_${Date.now()}`,
      leaveType: form.leaveType,
      fromDate: form.fromDate,
      toDate: form.toDate,
      days,
      reason: form.reason,
      status: "pending",
      appliedAt: new Date().toISOString().split("T")[0],
    };
    setRequests((prev) => [newReq, ...prev]);
    setApplying(false);
    setForm({ leaveType: "casual", fromDate: "", toDate: "", reason: "" });
    showFlash("Leave application submitted successfully");
  }

  const approved = requests.filter((r) => r.status === "approved").reduce((s, r) => s + r.days, 0);
  const pending = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-xl font-black text-[#10b981]">{approved}</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Days Approved</div>
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-xl font-black text-[#f59e0b]">{pending}</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Pending Requests</div>
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-xl font-black text-white">{requests.length}</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Total Applications</div>
        </div>
      </div>

      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#10b981]/15 border border-[#10b981]/25 text-[#10b981] text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}

      {/* Apply button */}
      {!applying && (
        <button onClick={() => setApplying(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-black bg-[#f59e0b] hover:bg-[#d97706] transition-all">
          <Plus className="w-4 h-4" /> Apply for Leave
        </button>
      )}

      {/* Application form */}
      {applying && (
        <div className="bg-[#131316] border border-[#f59e0b]/20 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-white">Apply for Leave</div>
            <button onClick={() => setApplying(false)}><X className="w-4 h-4 text-[#78788c]" /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Leave Type</label>
              <select value={form.leaveType} onChange={(e) => setForm((p) => ({ ...p, leaveType: e.target.value as LeaveRequest["leaveType"] }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
                {leaveTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)} Leave</option>)}
              </select>
            </div>
            <div /> {/* spacer */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">From Date *</label>
              <input type="date" value={form.fromDate} onChange={(e) => setForm((p) => ({ ...p, fromDate: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#f59e0b]/40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">To Date *</label>
              <input type="date" value={form.toDate} min={form.fromDate} onChange={(e) => setForm((p) => ({ ...p, toDate: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#f59e0b]/40" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Reason *</label>
              <textarea value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} rows={3}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#f59e0b]/40 resize-none" />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setApplying(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10">Cancel</button>
            <button onClick={applyLeave} disabled={!form.fromDate || !form.toDate || !form.reason}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-black bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-40 transition-all">
              <Check className="w-3.5 h-3.5" /> Submit Application
            </button>
          </div>
        </div>
      )}

      {/* Leave history */}
      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">Leave History</div>
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="bg-[#131316] border border-white/7 rounded-2xl p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${statusColor[r.status]}18`, color: statusColor[r.status] }}>
                {statusIcon[r.status]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs font-bold text-white capitalize">{r.leaveType} Leave</div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize"
                    style={{ background: `${statusColor[r.status]}18`, color: statusColor[r.status] }}>{r.status}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-[#78788c]">
                  <span className="flex items-center gap-1"><Calendar className="w-2.5 h-2.5" /> {r.fromDate} → {r.toDate}</span>
                  <span>{r.days} day{r.days !== 1 ? "s" : ""}</span>
                </div>
                <div className="text-[10px] text-[#b0b0c0] mt-1.5 leading-relaxed">{r.reason}</div>
                {r.adminRemarks && (
                  <div className="mt-2 p-2 rounded-lg bg-white/3 text-[10px] text-[#78788c] italic">
                    Admin: "{r.adminRemarks}"
                  </div>
                )}
              </div>
              <div className="text-[9px] text-[#46465a] shrink-0">Applied: {r.appliedAt}</div>
            </div>
          ))}
          {requests.length === 0 && (
            <div className="text-center py-10 text-xs text-[#46465a]">No leave applications found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
