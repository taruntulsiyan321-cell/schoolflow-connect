import { useCallback, useRef, useState, useEffect } from "react";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast } from "sonner";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function InitialsAvatar({
  name,
  size = "md",
  color,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  color?: string;
}) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  const colors = ["#3b5bdb", "#4b9fd4", "#6882e8", "#4aa87a", "#c08a3a"];
  const trimmedName = name.trim();
  const bg = color ?? (trimmedName ? colors[trimmedName.charCodeAt(0) % colors.length] : colors[0]);
  const cls = { sm: "w-7 h-7 text-[9px]", md: "w-9 h-9 text-[11px]", lg: "w-14 h-14 text-base" }[size];
  return (
    <div
      className={cn("rounded-full flex items-center justify-center font-black text-white shrink-0", cls)}
      style={{ background: `linear-gradient(135deg,${bg},${bg}99)` }}
    >
      {initials}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; text: string }> = {
    active: { label: "Active", bg: "#4aa87a22", text: "#4aa87a" },
    inactive: { label: "Inactive", bg: "#78788c22", text: "#78788c" },
    suspended: { label: "Suspended", bg: "#cc506922", text: "#cc5069" },
    published: { label: "Published", bg: "#4aa87a22", text: "#4aa87a" },
    draft: { label: "Draft", bg: "#78788c22", text: "#78788c" },
    scheduled: { label: "Scheduled", bg: "#4b9fd422", text: "#4b9fd4" },
    archived: { label: "Archived", bg: "#46465a33", text: "#46465a" },
    expired: { label: "Expired", bg: "#cc506922", text: "#cc5069" },
  };
  const s = map[status] ?? { label: status, bg: "#78788c22", text: "#78788c" };
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.text }}>
      {s.label}
    </span>
  );
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 bg-[#131316] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="text-white font-bold text-base mb-2">{title}</div>
        <div className="text-[#78788c] text-sm mb-6">{description}</div>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn("px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all", danger ? "bg-[#cc5069] hover:bg-[#b84460]" : "bg-[#3b5bdb] hover:bg-[#2f4fc4]")}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Undo-delete toast ────────────────────────────────────────────────────────

interface UndoToastState {
  message: string;
  type: "success" | "error" | "info";
  onUndo?: () => void;
  expiresAt?: number;
}

export function UndoToast({ state, onClose }: { state: UndoToastState; onClose: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(
    state.expiresAt ? Math.ceil((state.expiresAt - Date.now()) / 1000) : null
  );

  useEffect(() => {
    if (!state.expiresAt) return;
    const iv = setInterval(() => {
      const r = Math.ceil((state.expiresAt! - Date.now()) / 1000);
      setRemaining(r);
      if (r <= 0) { clearInterval(iv); onClose(); }
    }, 200);
    return () => clearInterval(iv);
  }, [state.expiresAt, onClose]);

  const colors = { success: "#4aa87a", error: "#cc5069", info: "#3b5bdb" };
  const color = colors[state.type];

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border border-white/10 bg-[#131316] min-w-64"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <span className="text-white text-sm font-semibold flex-1">{state.message}</span>
      {state.onUndo && (
        <button
          onClick={() => { state.onUndo!(); onClose(); }}
          className="text-xs font-bold px-3 py-1 rounded-lg transition-all"
          style={{ color, background: `${color}20` }}
        >
          Undo{remaining !== null && remaining > 0 ? ` (${remaining}s)` : ""}
        </button>
      )}
      <button onClick={onClose} className="text-[#78788c] hover:text-white ml-1 text-lg leading-none">×</button>
    </div>
  );
}

// Plain toast without undo
export function Toast({
  message,
  type = "success",
  onClose,
}: {
  message: string;
  type?: "success" | "error" | "info";
  onClose: () => void;
}) {
  return <UndoToast state={{ message, type }} onClose={onClose} />;
}

// Hook for undo-delete pattern — 5s window before permanent
export function useUndoDelete<T extends { id: string }>(
  setItems: React.Dispatch<React.SetStateAction<T[]>>
) {
  const [toast, setToast] = useState<UndoToastState | null>(null);
  const pendingRef = useRef<{ items: T[]; timer: ReturnType<typeof setTimeout> } | null>(null);

  const closeToast = useCallback(() => setToast(null), []);

  // Soft-delete: remove from UI immediately, schedule permanent deletion
  const softDelete = useCallback(
    (toRemove: T[], label: string, onPermanent?: () => void) => {
      // Cancel any previous pending delete
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);

      // Remove from state immediately
      setItems((prev) => prev.filter((x) => !toRemove.find((r) => r.id === x.id)));

      const expiresAt = Date.now() + 5000;
      const timer = setTimeout(() => {
        pendingRef.current = null;
        setToast(null);
        onPermanent?.();
      }, 5000);

      pendingRef.current = { items: toRemove, timer };

      setToast({
        message: label,
        type: "success",
        expiresAt,
        onUndo: () => {
          if (pendingRef.current) {
            clearTimeout(pendingRef.current.timer);
            const restored = pendingRef.current.items;
            setItems((prev) => [...restored, ...prev]);
            pendingRef.current = null;
          }
        },
      });
    },
    [setItems]
  );

  return { toast, closeToast, softDelete };
}

// Export helpers
export function exportCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    toast.error("Nothing to export — this report has no rows.");
    return;
  }
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export function printSection(title: string, content: string) {
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Print popup was blocked. Please allow popups for this site and try again.");
    return;
  }
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;padding:2rem;color:#111}h1{margin-bottom:1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px;font-size:13px}th{background:#f3f4f6}</style>
    </head><body><h1>${title}</h1>${content}</body></html>`);
  win.document.close();
  win.print();
}
