import { useMemo, useState } from "react";
import { Loader2, Search, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatContact } from "@/academic";
import { MessageService } from "@/academic";

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
  /** Principal Messages uses CSS vars; keep dark sheet tokens by default. */
  variant?: "dark" | "surface";
};

/**
 * WhatsApp-style contact picker: searchable directory of allowed DM peers.
 * Groups are excluded — use Create Group elsewhere.
 */
export function NewChatSheet({
  open,
  onClose,
  contacts,
  onSelect,
  busy = false,
  variant = "dark",
}: NewChatSheetProps) {
  const [query, setQuery] = useState("");
  const [pickingId, setPickingId] = useState<string | null>(null);

  const peers = useMemo(() => contacts.filter((c) => !isGroup(c)), [contacts]);
  const filtered = useMemo(
    () => MessageService.searchContacts(peers, query),
    [peers, query],
  );

  if (!open) return null;

  const dark = variant === "dark";

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        aria-label="Close new chat"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        disabled={busy || Boolean(pickingId)}
      />
      <div
        role="dialog"
        aria-labelledby="new-chat-title"
        className={cn(
          "relative z-10 w-full sm:max-w-md flex flex-col shadow-2xl",
          "rounded-t-2xl sm:rounded-2xl max-h-[85vh] sm:max-h-[70vh]",
          dark
            ? "bg-[#131316] border border-white/10"
            : "bg-[var(--surface)] border border-[var(--border)]",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between gap-3 px-4 py-3.5 border-b shrink-0",
            dark ? "border-white/7" : "border-[var(--border)]",
          )}
        >
          <div>
            <h2
              id="new-chat-title"
              className={cn(
                "text-sm font-bold",
                dark ? "text-white" : "text-[var(--text-primary)]",
              )}
            >
              New chat
            </h2>
            <p className={cn("text-[10px] mt-0.5", dark ? "text-[#78788c]" : "text-[var(--text-muted)]")}>
              Pick a contact to start messaging
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy || Boolean(pickingId)}
            className={cn(
              "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
              dark
                ? "bg-white/5 border border-white/10 text-[#78788c] hover:text-white"
                : "bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)]",
            )}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={cn("px-3 py-2.5 border-b shrink-0", dark ? "border-white/7" : "border-[var(--border)]")}>
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2",
              dark
                ? "bg-white/5 border border-white/10"
                : "bg-[var(--bg)] border border-[var(--border)]",
            )}
          >
            <Search className={cn("w-3.5 h-3.5 shrink-0", dark ? "text-[#46465a]" : "text-[var(--text-muted)]")} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or role…"
              className={cn(
                "flex-1 bg-transparent text-xs outline-none",
                dark
                  ? "text-white placeholder:text-[#46465a]"
                  : "text-[var(--text-primary)] placeholder:text-[var(--text-muted)]",
              )}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/5 min-h-0">
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center">
              <Users className={cn("w-8 h-8 mx-auto mb-2 opacity-50", dark ? "text-[#46465a]" : "text-[var(--text-muted)]")} />
              <p className={cn("text-xs", dark ? "text-[#78788c]" : "text-[var(--text-muted)]")}>
                {peers.length === 0
                  ? "No contacts available yet."
                  : "No contacts match your search."}
              </p>
            </div>
          )}
          {filtered.map((c) => {
            const id = c.userId;
            const pending = pickingId === id;
            const tone = roleTone[c.role] || (dark ? "text-[#78788c]" : "text-[var(--text-muted)]");
            return (
              <button
                key={id}
                type="button"
                disabled={busy || Boolean(pickingId)}
                onClick={() => {
                  setPickingId(id);
                  void Promise.resolve(onSelect(c)).finally(() => setPickingId(null));
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors disabled:opacity-50",
                  dark ? "hover:bg-white/[0.04]" : "hover:bg-[var(--surface-2)]",
                )}
              >
                {c.avatarUrl ? (
                  <img
                    src={c.avatarUrl}
                    alt=""
                    className="w-10 h-10 rounded-xl object-cover shrink-0"
                  />
                ) : (
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center text-[10px] font-black shrink-0",
                      dark
                        ? "bg-[#3b5bdb]/20 text-[#818cf8]"
                        : "bg-[var(--indigo-light)] text-[var(--indigo)]",
                    )}
                  >
                    {initials(c.name)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-xs font-bold truncate",
                      dark ? "text-white" : "text-[var(--text-primary)]",
                    )}
                  >
                    {c.name}
                  </div>
                  <div className={cn("text-[10px] font-semibold capitalize mt-0.5", tone)}>
                    {c.role.replace(/_/g, " ")}
                  </div>
                </div>
                {pending ? (
                  <Loader2 className={cn("w-4 h-4 animate-spin shrink-0", dark ? "text-[#818cf8]" : "text-[var(--indigo)]")} />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
