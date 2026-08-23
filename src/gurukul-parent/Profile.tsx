import { useEffect, useRef, useState } from "react";
import {
  User, Lock, Link2, Edit2, Save, X, Check, Smartphone, Shield, Loader2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border/70 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border/70">
        <div className="w-8 h-8 rounded-xl bg-[#3b5bdb]/15 flex items-center justify-center text-[#3b5bdb]">{icon}</div>
        <div className="text-sm font-bold text-foreground">{title}</div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function EditableField({
  label,
  value,
  editing,
  onChange,
  type = "text",
  disabled,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{label}</label>
      {editing && !disabled ? (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-muted border border-[#3b5bdb]/30 rounded-xl px-3 py-2 text-sm text-foreground outline-none focus:border-[#3b5bdb]/60 transition-all"
        />
      ) : (
        <div className="text-sm text-foreground px-0.5">
          {value || <span className="text-muted-foreground">Not set</span>}
        </div>
      )}
    </div>
  );
}

type ParentRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
};

/**
 * Parent profile â€” live auth profile + parents row. Password via Supabase Auth.
 * No fake Google/link success toasts.
 */
export default function ParentProfile() {
  const { profile, user, updatePassword, refreshAuth } = useAuth();
  const [parentRow, setParentRow] = useState<ParentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ next: "", confirm: "" });
  const [pwdSaving, setPwdSaving] = useState(false);
  const changePwdDialogRef = useRef<HTMLDivElement>(null);

  const displayName = parentRow?.full_name || profile?.fullName || "";
  const email = parentRow?.email || profile?.email || user?.email || "";
  const phone = parentRow?.phone || "";

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("parents")
        .select("id, full_name, email, phone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setParentRow(null);
        setLoading(false);
        return;
      }
      setLoadError(null);
      setParentRow(data);
      setDraftName(data?.full_name || profile?.fullName || "");
      setDraftPhone(data?.phone || "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, profile?.fullName]);

  function showFlash(msg: string) {
    setFlashError(null);
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }

  function showError(msg: string) {
    setFlash(null);
    setFlashError(msg);
    setTimeout(() => setFlashError(null), 4000);
  }

  function startEdit() {
    setDraftName(displayName);
    setDraftPhone(phone);
    setEditing(true);
  }

  async function saveEdit() {
    if (!user || !parentRow) {
      showError("No parent record linked to this account.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("parents")
      .update({
        full_name: draftName.trim(),
        phone: draftPhone.trim() || null,
      })
      .eq("id", parentRow.id);
    if (error) {
      setSaving(false);
      showError(error.message);
      return;
    }
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ full_name: draftName.trim() })
      .eq("id", user.id);
    setSaving(false);
    if (profileErr) {
      showError(`Parent record saved, but profile name sync failed: ${profileErr.message}`);
    }
    setParentRow((p) =>
      p
        ? { ...p, full_name: draftName.trim(), phone: draftPhone.trim() || null }
        : p,
    );
    setEditing(false);
    await refreshAuth();
    if (!profileErr) showFlash("Profile updated");
  }

  // Escape-to-close + a simple focus trap while the Change Password dialog is open.
  useEffect(() => {
    if (!changePwdOpen) return;
    const container = changePwdDialogRef.current;
    const focusable = container?.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setChangePwdOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = changePwdDialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !container?.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !container?.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [changePwdOpen]);

  async function handleChangePwd() {
    if (!pwdForm.next || pwdForm.next !== pwdForm.confirm) return;
    setPwdSaving(true);
    const { error } = await updatePassword(pwdForm.next);
    setPwdSaving(false);
    if (error) {
      showError(error);
      return;
    }
    setChangePwdOpen(false);
    setPwdForm({ next: "", confirm: "" });
    showFlash("Password updated");
  }

  const initials = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading profileâ€¦
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#3b5bdb]/15 border border-[#3b5bdb]/25 text-[#3b5bdb] text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}
      {flashError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#cc5069]/15 border border-[#cc5069]/25 text-[#cc5069] text-xs font-semibold">
          {flashError}
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#cc5069]/15 border border-[#cc5069]/25 text-[#cc5069] text-xs font-semibold">
          Failed to load parent profile: {loadError}
        </div>
      )}

      <div className="bg-surface border border-border/70 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
          <span className="text-xl font-black text-foreground">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-black text-foreground">{displayName || "Parent"}</div>
          <div className="text-[10px] text-muted-foreground">{email || "â€”"}</div>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            disabled={!parentRow}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-foreground bg-[#3b5bdb] hover:bg-[#6882e8] transition-all shrink-0 disabled:opacity-40"
          >
            <Edit2 className="w-3.5 h-3.5" /> Edit Profile
          </button>
        ) : (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-muted-foreground bg-muted hover:bg-muted/80 transition-all"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-foreground bg-[#3b5bdb] hover:bg-[#6882e8] transition-all disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" /> {saving ? "Savingâ€¦" : "Save"}
            </button>
          </div>
        )}
      </div>

      <Section title="Personal Information" icon={<User className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <EditableField
              label="Full Name"
              value={editing ? draftName : displayName}
              editing={editing}
              onChange={setDraftName}
            />
          </div>
          <EditableField
            label="Email Address"
            value={email}
            editing={false}
            onChange={() => {}}
            disabled
          />
          <EditableField
            label="Phone Number"
            value={editing ? draftPhone : phone}
            editing={editing}
            onChange={setDraftPhone}
            type="tel"
          />
        </div>
        {!parentRow && (
          <p className="text-[10px] text-[#c08a3a] mt-3">
            No parent record linked to this account â€” contact the school admin to link your profile.
          </p>
        )}
      </Section>

      <Section title="Account" icon={<Link2 className="w-4 h-4" />}>
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted">
            <div className="w-8 h-8 rounded-lg bg-[#3b5bdb]/15 flex items-center justify-center">
              <Smartphone className="w-4 h-4 text-[#3b5bdb]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground">Signed-in account</div>
              <div className="text-[10px] text-muted-foreground">{email || "â€”"}</div>
            </div>
            <span className="text-[9px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/15 px-2 py-0.5 rounded-full">
              Active
            </span>
          </div>
        </div>
      </Section>

      <Section title="Security" icon={<Shield className="w-4 h-4" />}>
        <div className="flex items-center justify-between p-3 rounded-xl bg-muted">
          <div>
            <div className="text-xs font-semibold text-foreground">Password</div>
            <div className="text-[10px] text-muted-foreground">Update via Supabase Auth</div>
          </div>
          <button
            type="button"
            onClick={() => setChangePwdOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#c08a3a] bg-[#c08a3a]/10 hover:bg-[#c08a3a]/15 transition-all"
          >
            <Lock className="w-3.5 h-3.5" /> Change
          </button>
        </div>
      </Section>

      {changePwdOpen && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setChangePwdOpen(false)} />
          <div
            ref={changePwdDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-pwd-title"
            className="relative z-10 bg-surface border border-border rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <div id="change-pwd-title" className="text-sm font-bold text-foreground">Change Password</div>
              <button type="button" onClick={() => setChangePwdOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            {[
              { label: "New Password", key: "next" as const },
              { label: "Confirm New Password", key: "confirm" as const },
            ].map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{f.label}</label>
                <input
                  type="password"
                  value={pwdForm[f.key]}
                  onChange={(e) => setPwdForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="bg-muted border border-border rounded-xl px-3 py-2 text-sm text-foreground outline-none focus:border-[#3b5bdb]/40"
                />
              </div>
            ))}
            {pwdForm.next && pwdForm.confirm && pwdForm.next !== pwdForm.confirm && (
              <div className="text-[10px] text-[#cc5069]">Passwords do not match</div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setChangePwdOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground bg-muted hover:bg-muted/80 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleChangePwd()}
                disabled={pwdSaving || !pwdForm.next || pwdForm.next !== pwdForm.confirm}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-foreground bg-[#3b5bdb] hover:bg-[#6882e8] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {pwdSaving ? "Updatingâ€¦" : "Change Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
