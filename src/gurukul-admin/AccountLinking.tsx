import { useState } from "react";
import {
  Mail, Smartphone, Lock, UserCheck, UserX, ShieldOff, RotateCcw,
  Link, Link2Off, Send, Check,
} from "lucide-react";
import { cn } from "./shared";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AccountLinkingProps {
  entityName: string;
  entityType: "student" | "teacher" | "parent";
  status: string;
}

interface LinkedAccount {
  googleEmail: string | null;
  mobile: string | null;
  activationSent: boolean;
  accountStatus: "active" | "inactive" | "suspended";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function ActionButton({
  icon, label, color, onClick, variant = "ghost",
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
  variant?: "ghost" | "solid";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all",
        variant === "solid"
          ? `text-white`
          : `hover:text-white`
      )}
      style={variant === "solid"
        ? { background: color, color: "white" }
        : { background: `${color}18`, color }
      }
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </button>
  );
}

function LinkRow({
  icon, label, value, onLink, onUnlink, onEdit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  onLink: () => void;
  onUnlink: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="p-3 rounded-xl bg-white/3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[#78788c]">{icon}</span>
        <span className="text-[9px] font-bold text-[#78788c] uppercase tracking-wider flex-1">{label}</span>
        {value && (
          <button onClick={onUnlink} className="text-[9px] text-[#cc5069] hover:underline flex items-center gap-0.5">
            <Link2Off className="w-2.5 h-2.5" /> Remove
          </button>
        )}
      </div>
      {value ? (
        <div className="flex items-center gap-2">
          <div className="text-xs text-white flex-1 truncate">{value}</div>
          <button onClick={onEdit} className="text-[10px] text-[#3b5bdb] hover:underline">Change</button>
        </div>
      ) : (
        <button
          onClick={onLink}
          className="flex items-center gap-1.5 text-[10px] text-[#3b5bdb] hover:underline"
        >
          <Link className="w-3 h-3" /> Link account
        </button>
      )}
    </div>
  );
}

// ── Modal for linking ──────────────────────────────────────────────────────────

function LinkModal({
  label,
  placeholder,
  onSave,
  onClose,
}: {
  label: string;
  placeholder: string;
  onSave: (val: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-[#131316] border border-white/10 rounded-2xl p-5 w-72 shadow-2xl space-y-4">
        <div className="text-sm font-bold text-white">Link {label}</div>
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#3b5bdb]/50"
        />
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
            Cancel
          </button>
          <button
            onClick={() => { if (val.trim()) { onSave(val.trim()); onClose(); } }}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AccountLinkingPanel({ entityType, status }: AccountLinkingProps) {
  const [account, setAccount] = useState<LinkedAccount>({
    googleEmail: entityType === "teacher" ? "teacher@gmail.com" : null,
    mobile: null,
    activationSent: false,
    accountStatus: status === "active" ? "active" : status === "suspended" ? "suspended" : "inactive",
  });

  const [linkModal, setLinkModal] = useState<null | "google" | "mobile">(null);
  const [flash, setFlash] = useState<string | null>(null);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  function sendActivation() {
    setAccount((a) => ({ ...a, activationSent: true }));
    showFlash("Activation invitation sent");
  }

  function resetPassword() {
    showFlash("Password reset link sent");
  }

  function setAccountStatus(s: "active" | "inactive" | "suspended") {
    setAccount((a) => ({ ...a, accountStatus: s }));
    const labels = { active: "Account activated", inactive: "Account deactivated", suspended: "Account suspended" };
    showFlash(labels[s]);
  }

  const statusColor = account.accountStatus === "active" ? "#4aa87a"
    : account.accountStatus === "suspended" ? "#cc5069" : "#c08a3a";

  return (
    <div className="space-y-3">
      {/* Flash notification */}
      {flash && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#4aa87a]/15 border border-[#4aa87a]/25 text-[#4aa87a] text-xs font-semibold">
          <Check className="w-3.5 h-3.5 shrink-0" /> {flash}
        </div>
      )}

      {/* Account Status */}
      <div className="p-3 rounded-xl bg-white/3 space-y-2">
        <div className="text-[9px] font-bold text-[#78788c] uppercase tracking-wider">Account Status</div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor }} />
          <div className="text-xs font-semibold capitalize" style={{ color: statusColor }}>{account.accountStatus}</div>
        </div>
      </div>

      {/* Google Account Linking */}
      <LinkRow
        icon={<Mail className="w-3.5 h-3.5" />}
        label="Google Account"
        value={account.googleEmail}
        onLink={() => setLinkModal("google")}
        onUnlink={() => { setAccount((a) => ({ ...a, googleEmail: null })); showFlash("Google account removed"); }}
        onEdit={() => setLinkModal("google")}
      />

      {/* Mobile Linking */}
      <LinkRow
        icon={<Smartphone className="w-3.5 h-3.5" />}
        label="Mobile Number"
        value={account.mobile}
        onLink={() => setLinkModal("mobile")}
        onUnlink={() => { setAccount((a) => ({ ...a, mobile: null })); showFlash("Mobile number removed"); }}
        onEdit={() => setLinkModal("mobile")}
      />

      {/* Divider */}
      <div className="border-t border-white/7 my-1" />

      {/* Actions */}
      <div className="space-y-2">
        <ActionButton
          icon={<Send className="w-3.5 h-3.5" />}
          label={account.activationSent ? "Invitation Sent" : "Send Activation Invitation"}
          color="#3b5bdb"
          onClick={sendActivation}
        />
        <ActionButton
          icon={<Lock className="w-3.5 h-3.5" />}
          label="Reset Password"
          color="#c08a3a"
          onClick={resetPassword}
        />
      </div>

      {/* Account lifecycle actions */}
      <div className="space-y-2">
        {account.accountStatus !== "active" && (
          <ActionButton
            icon={<UserCheck className="w-3.5 h-3.5" />}
            label="Activate Account"
            color="#4aa87a"
            onClick={() => setAccountStatus("active")}
          />
        )}
        {account.accountStatus === "active" && (
          <ActionButton
            icon={<UserX className="w-3.5 h-3.5" />}
            label="Deactivate Account"
            color="#cc5069"
            onClick={() => setAccountStatus("inactive")}
          />
        )}
        {account.accountStatus !== "suspended" && (
          <ActionButton
            icon={<ShieldOff className="w-3.5 h-3.5" />}
            label="Suspend Account"
            color="#cc5069"
            onClick={() => setAccountStatus("suspended")}
          />
        )}
        {account.accountStatus === "suspended" && (
          <ActionButton
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            label="Restore Account"
            color="#4aa87a"
            onClick={() => setAccountStatus("active")}
          />
        )}
      </div>

      {/* Link modal */}
      {linkModal && (
        <LinkModal
          label={linkModal === "google" ? "Google Account" : "Mobile Number"}
          placeholder={linkModal === "google" ? "user@gmail.com" : "+91 98765 43210"}
          onSave={(val) => {
            if (linkModal === "google") setAccount((a) => ({ ...a, googleEmail: val }));
            else setAccount((a) => ({ ...a, mobile: val }));
            showFlash(linkModal === "google" ? "Google account linked" : "Mobile number linked");
          }}
          onClose={() => setLinkModal(null)}
        />
      )}
    </div>
  );
}
