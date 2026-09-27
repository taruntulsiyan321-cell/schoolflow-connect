import { useState, useEffect } from "react";
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
      className={cn("rounded-full flex items-center justify-center font-black text-foreground shrink-0", cls)}
      style={{ background: `linear-gradient(135deg,${bg},${bg}99)` }}
    >
      {initials}
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
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border border-border bg-surface min-w-64"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <span className="text-foreground text-sm font-semibold flex-1">{state.message}</span>
      {state.onUndo && (
        <button
          onClick={() => { state.onUndo!(); onClose(); }}
          className="text-xs font-bold px-3 py-1 rounded-lg transition-all"
          style={{ color, background: `${color}20` }}
        >
          Undo{remaining !== null && remaining > 0 ? ` (${remaining}s)` : ""}
        </button>
      )}
      <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-1 text-lg leading-none">×</button>
    </div>
  );
}


// Export helpers.
//
// `exportCSV` moved to `@/lib/exportCsv` when the teacher's test report and the
// student's own report — neither of them admin screens — also had to be
// downloadable (§10.25). Re-exported here so every existing admin import site
// keeps working and there is still only one implementation.
export { exportCSV } from "@/lib/exportCsv";

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
