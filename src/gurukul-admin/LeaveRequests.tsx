import { useEffect, useMemo, useState } from "react";
import {
  Search, Eye, CheckCircle2, XCircle, Calendar, Loader2, X,
} from "lucide-react";
import { cn, InitialsAvatar, UndoToast } from "./shared";
import { LeaveService, useAcademicLive, type SchoolLeaveRequestRow } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toast } from "sonner";

type LeaveStatus = "pending" | "approved" | "rejected";
type LeaveType = "casual" | "sick" | "earned" | "maternity" | "paternity" | "emergency" | "unpaid";

const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: "Casual Leave",
  sick: "Sick Leave",
  earned: "Earned Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  emergency: "Emergency Leave",
  unpaid: "Unpaid Leave",
};

const STATUS_CONFIG: Record<LeaveStatus, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "#c08a3a", bg: "#c08a3a20" },
  approved: { label: "Approved", color: "#4aa87a", bg: "#4aa87a20" },
  rejected: { label: "Rejected", color: "#cc5069", bg: "#cc506920" },
};

function leaveTypeLabel(type: string): string {
  return LEAVE_TYPE_LABELS[type] ?? type;
}

function ResolveModal({
  request,
  action,
  busy,
  onConfirm,
  onClose,
}: {
  request: SchoolLeaveRequestRow;
  action: "approve" | "reject";
  busy: boolean;
  onConfirm: (remarks: string) => void;
  onClose: () => void;
}) {
  const [remarks, setRemarks] = useState("");
  const cfg =
    action === "approve"
      ? { label: "Approve Leave", color: "#4aa87a", btnClass: "bg-[#4aa87a] hover:bg-[#3d9068]" }
      : { label: "Reject Leave", color: "#cc5069", btnClass: "bg-[#cc5069] hover:bg-[#b84460]" };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-[#131316] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="text-sm font-bold text-white mb-1">{cfg.label}</div>
        <div className="text-[10px] text-[#78788c] mb-4">
          {request.applicantName} · {leaveTypeLabel(request.leaveType)} · {request.fromDate}
          {request.fromDate !== request.toDate && ` → ${request.toDate}`} ({request.days}d)
        </div>
        <div className="flex flex-col gap-1 mb-5">
          <label htmlFor="leave-resolve-remarks" className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">
            Remarks (optional — stored on audit event)
          </label>
          <textarea
            id="leave-resolve-remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            placeholder="Add a note for this decision…"
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-[#3b5bdb]/50"
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(remarks)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50",
              cfg.btnClass,
            )}
          >
            {busy ? "Saving…" : cfg.label}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeaveDetail({
  request,
  onClose,
  onAction,
}: {
  request: SchoolLeaveRequestRow;
  onClose: () => void;
  onAction: (action: "approve" | "reject") => void;
}) {
  const cfg = STATUS_CONFIG[request.status];

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-80 sm:w-96 bg-[#0a0a0c] border-l border-white/7 flex flex-col h-full overflow-hidden">
        <div className="p-5 border-b border-white/7 flex items-start gap-3">
          <InitialsAvatar name={request.applicantName} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">{request.applicantName}</div>
            <div className="text-[10px] text-[#78788c]">
              {request.department ?? request.applicantKind}
            </div>
            <div className="mt-1">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: cfg.bg, color: cfg.color }}
              >
                {cfg.label}
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-[#78788c] hover:text-white shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {[
            { label: "Leave Type", value: leaveTypeLabel(request.leaveType) },
            { label: "Applicant", value: request.applicantKind },
            { label: "From Date", value: request.fromDate },
            { label: "To Date", value: request.toDate },
            { label: "Duration", value: `${request.days} day${request.days > 1 ? "s" : ""}` },
            {
              label: "Requested At",
              value: new Date(request.createdAt).toLocaleString("en-IN"),
            },
          ].map((row) => (
            <div key={row.label} className="flex flex-col gap-1 p-3 rounded-xl bg-white/3">
              <div className="text-[9px] text-[#46465a] uppercase tracking-wider">{row.label}</div>
              <div className="text-xs text-white capitalize">{row.value}</div>
            </div>
          ))}

          <div className="flex flex-col gap-1 p-3 rounded-xl bg-white/3">
            <div className="text-[9px] text-[#46465a] uppercase tracking-wider">Reason</div>
            <div className="text-xs text-[#c8c8d4] leading-relaxed">{request.reason || "—"}</div>
          </div>

          {request.reviewedAt && (
            <div className="flex flex-col gap-1 p-3 rounded-xl bg-white/3">
              <div className="text-[9px] text-[#46465a] uppercase tracking-wider">Reviewed</div>
              <div className="text-xs text-[#c8c8d4]">
                {new Date(request.reviewedAt).toLocaleString("en-IN")}
              </div>
            </div>
          )}
        </div>

        {request.status === "pending" && (
          <div className="p-4 border-t border-white/7 space-y-2">
            <button
              type="button"
              onClick={() => onAction("approve")}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#4aa87a] hover:bg-[#3d9068] transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve Leave
            </button>
            <button
              type="button"
              onClick={() => onAction("reject")}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#cc5069] hover:bg-[#b84460] transition-all flex items-center justify-center gap-2"
            >
              <XCircle className="w-4 h-4" /> Reject Leave
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Admin Leave Requests — LeaveService.listForSchool / review only.
 * No local-only approve toasts; empty when none.
 */
export default function LeaveRequests() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["profile"]);
  const [requests, setRequests] = useState<SchoolLeaveRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<LeaveStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [detail, setDetail] = useState<SchoolLeaveRequestRow | null>(null);
  const [resolveModal, setResolveModal] = useState<{
    request: SchoolLeaveRequestRow;
    action: "approve" | "reject";
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!ready || !ctx) return;
    setLoading(true);
    try {
      const rows = await LeaveService.listForSchool(ctx, { status: "all", limit: 300 });
      setRequests(rows);
      setError(null);
      setDetail((prev) => (prev ? rows.find((r) => r.id === prev.id) ?? null : null));
    } catch (e) {
      setRequests([]);
      setError(e instanceof Error ? e.message : "Failed to load leave requests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, liveVersion]);

  const filtered = useMemo(() => {
    let list = requests;
    if (statusTab !== "all") list = list.filter((r) => r.status === statusTab);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.applicantName.toLowerCase().includes(q) ||
          (r.reason ?? "").toLowerCase().includes(q),
      );
    }
    if (filterType !== "all") list = list.filter((r) => r.leaveType === filterType);
    return [...list].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [requests, statusTab, search, filterType]);

  async function resolveRequest(id: string, status: Exclude<LeaveStatus, "pending">, remarks: string) {
    if (!ctx) return;
    setBusy(true);
    try {
      await LeaveService.review(ctx, id, status, remarks);
      setResolveModal(null);
      setToastMsg(status === "approved" ? "Leave approved" : "Leave rejected");
      setTimeout(() => setToastMsg(null), 3000);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  const tabCounts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length };
    requests.forEach((r) => {
      c[r.status] = (c[r.status] ?? 0) + 1;
    });
    return c;
  }, [requests]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading leave requests…
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-[#cc5069] py-16 text-center">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#46465a]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by applicant or reason…"
            className="w-full bg-[#131316] border border-white/7 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#3b5bdb]/50"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-[#131316] border border-white/7 rounded-xl px-3 py-2.5 text-sm text-[#78788c] focus:outline-none focus:border-[#3b5bdb]/50"
        >
          <option value="all">All Leave Types</option>
          {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((k) => (
            <option key={k} value={k}>
              {LEAVE_TYPE_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-1 p-1 bg-[#131316] border border-white/7 rounded-2xl w-fit">
        {(
          [
            { key: "all", label: "All" },
            { key: "pending", label: "Pending" },
            { key: "approved", label: "Approved" },
            { key: "rejected", label: "Rejected" },
          ] as { key: LeaveStatus | "all"; label: string }[]
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
              statusTab === tab.key
                ? "bg-[#3b5bdb]/15 text-[#3b5bdb]"
                : "text-[#78788c] hover:text-white",
            )}
          >
            {tab.label}
            <span
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded-full",
                statusTab === tab.key
                  ? "bg-[#3b5bdb]/20 text-[#a5b4fc]"
                  : "bg-white/5 text-[#46465a]",
              )}
            >
              {tabCounts[tab.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 bg-[#131316] border border-white/7 rounded-2xl">
            <Calendar className="w-8 h-8 text-[#46465a]" />
            <div className="text-sm text-[#78788c]">No leave requests found</div>
            <div className="text-[10px] text-[#46465a]">LeaveService · school-scoped</div>
          </div>
        )}

        {filtered.map((req) => {
          const cfg = STATUS_CONFIG[req.status];
          return (
            <div
              key={req.id}
              className="bg-[#131316] border border-white/7 rounded-2xl p-4 hover:border-white/12 transition-all group"
            >
              <div className="flex items-start gap-4">
                <InitialsAvatar name={req.applicantName} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-bold text-white">{req.applicantName}</span>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: cfg.bg, color: cfg.color }}
                    >
                      {cfg.label}
                    </span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-[#78788c]">
                      {leaveTypeLabel(req.leaveType)}
                    </span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-[#78788c] capitalize">
                      {req.applicantKind}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#78788c] mb-1">
                    {req.department ?? "—"}
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-[#78788c] mb-2">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> {req.fromDate}
                      {req.fromDate !== req.toDate ? ` → ${req.toDate}` : ""}
                    </span>
                    <span>
                      {req.days} day{req.days > 1 ? "s" : ""}
                    </span>
                    <span>
                      {new Date(req.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>
                  <div className="text-xs text-[#78788c] line-clamp-1">{req.reason || "—"}</div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    onClick={() => setDetail(req)}
                    className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  {req.status === "pending" && (
                    <>
                      <button
                        type="button"
                        onClick={() => setResolveModal({ request: req, action: "approve" })}
                        className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#4aa87a]/20 flex items-center justify-center text-[#78788c] hover:text-[#4aa87a] transition-all"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setResolveModal({ request: req, action: "reject" })}
                        className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#cc5069]/20 flex items-center justify-center text-[#78788c] hover:text-[#cc5069] transition-all"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <LeaveDetail
          request={detail}
          onClose={() => setDetail(null)}
          onAction={(action) => setResolveModal({ request: detail, action })}
        />
      )}

      {resolveModal && (
        <ResolveModal
          request={resolveModal.request}
          action={resolveModal.action}
          busy={busy}
          onConfirm={(remarks) => {
            void resolveRequest(
              resolveModal.request.id,
              resolveModal.action === "approve" ? "approved" : "rejected",
              remarks,
            );
          }}
          onClose={() => setResolveModal(null)}
        />
      )}

      {toastMsg && (
        <UndoToast state={{ message: toastMsg, type: "success" }} onClose={() => setToastMsg(null)} />
      )}
    </div>
  );
}
