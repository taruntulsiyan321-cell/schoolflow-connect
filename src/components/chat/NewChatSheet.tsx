import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatContact } from "@/academic";
import { MessageService } from "@/academic";
import { toEnumLabel } from "@/lib/presentation";

function isGroup(c: ChatContact) {
  return (
    c.kind === "class_group" ||
    c.kind === "teacher_group" ||
    c.role === "class_group" ||
    c.role === "teacher_group"
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const roleTone: Record<string, string> = {
  admin: "text-emerald-400",
  principal: "text-rose-400",
  teacher: "text-[#818cf8]",
  student: "text-indigo-300",
  parent: "text-amber-400",
};

type NewChatSheetProps = {
  open: boolean;
  onClose: () => void;
  contacts: ChatContact[];
  onSelect: (contact: ChatContact) => void | Promise<void>;
  busy?: boolean;
};

/** Searchable DM contact picker (Gurukul dark). Portaled + z-modal to clear shell stacking traps. */
export function NewChatSheet({
  open,
  onClose,
  contacts,
  onSelect,
  busy = false,
}: NewChatSheetProps) {
  const [query, setQuery] = useState("");
  const [pickingId, setPickingId] = useState<string | null>(null);

  const peers = useMemo(() => contacts.filter((c) => !isGroup(c)), [contacts]);
  const filtered = useMemo(
    () => MessageService.searchContacts(peers, query),
    [peers, query],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPickingId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy && !pickingId) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, pickingId, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        aria-label="Close new chat"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        disabled={busy || Boolean(pickingId)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-chat-title"
        className="relative z-10 w-full sm:max-w-md flex flex-col shadow-2xl rounded-t-2xl sm:rounded-2xl max-h-[85vh] sm:max-h-[70vh] bg-surface border border-border"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-border/70 shrink-0">
          <div>
            <h2 id="new-chat-title" className="text-sm font-bold text-foreground">
              New chat
            </h2>
            <p className="text-[10px] mt-0.5 text-muted-foreground">
              Pick a contact to start messaging
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy || Boolean(pickingId)}
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-white/5 border border-border text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-2.5 border-b border-border/70 shrink-0">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 bg-white/5 border border-border">
            <Search className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or roleâ€¦"
              className="flex-1 bg-transparent text-xs outline-none text-white placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/5 min-h-0">
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-50 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                {peers.length === 0
                  ? "No contacts available yet."
                  : "No contacts match your search."}
              </p>
            </div>
          )}
          {filtered.map((c) => {
            const pending = pickingId === c.userId;
            const tone = roleTone[c.role] || "text-muted-foreground";
            return (
              <button
                key={c.userId}
                type="button"
                disabled={busy || Boolean(pickingId)}
                onClick={() => {
                  setPickingId(c.userId);
                  void Promise.resolve(onSelect(c)).finally(() => setPickingId(null));
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors disabled:opacity-50 hover:bg-white/[0.04]"
              >
                {c.avatarUrl ? (
                  <img src={c.avatarUrl} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[10px] font-black shrink-0 bg-primary/20 text-primary">
                    {initials(c.name)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate text-foreground">{c.name}</div>
                  <div className={cn("text-[10px] font-semibold capitalize mt-0.5", tone)}>
                    {toEnumLabel(c.role, "app_role")}
                  </div>
                </div>
                {pending ? <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
