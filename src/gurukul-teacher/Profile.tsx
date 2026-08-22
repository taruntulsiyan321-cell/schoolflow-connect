import { useEffect, useState } from "react";
import {
  User, Mail, Lock, Link2,
  Edit2, Save, X, Check, Smartphone, Shield, Briefcase, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useTeacherIdentity, teacherInitials } from "./useTeacherIdentity";
import type { TeacherProfile } from "./data";

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

function Field({
  label,
  value,
  editing,
  onChange,
  type = "text",
  disabled = false,
  disabledHint,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  type?: string;
  /** True when this field cannot actually be saved right now (e.g. unlinked
   * teacher record) â€” shown read-only with an explanation instead of
   * silently accepting edits that will be dropped on save. */
  disabled?: boolean;
  disabledHint?: string;
}) {
  const isEditable = editing && !disabled;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{label}</label>
      {isEditable ? (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-white/5 border border-[#3b5bdb]/30 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#3b5bdb]/60 transition-all"
        />
      ) : (
        <div className="text-sm text-white px-0.5" title={editing && disabled ? disabledHint : undefined}>
          {value || <span className="text-muted-foreground">Not set</span>}
          {editing && disabled && disabledHint && (
            <span className="block text-[9px] text-[#f59e0b] mt-0.5 font-normal normal-case">{disabledHint}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function TeacherProfile() {
  const { user } = useAuth();
  const identity = useTeacherIdentity();
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TeacherProfile | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: "", next: "", confirm: "" });
  const [pwdSaving, setPwdSaving] = useState(false);

  useEffect(() => {
    if (identity.loading) return;
    const next: TeacherProfile = {
      id: identity.id,
      name: identity.name,
      employeeId: identity.employeeId,
      email: identity.email,
      phone: identity.phone,
      department: identity.department,
      subjects: identity.subjects,
      qualification: identity.qualification,
      joinedDate: identity.joinedDate,
      address: identity.address,
      gender: identity.gender,
      isClassTeacher: identity.isClassTeacher,
      classTeacherOf: identity.classTeacherOf,
      googleLinked: identity.googleLinked,
      googleEmail: identity.googleEmail,
      mobileLinked: identity.mobileLinked,
    };
    setProfile(next);
    if (!editing) setDraft(next);
  }, [identity, editing]);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }

  function d(key: keyof TeacherProfile, value: string) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveProfile() {
    if (!user || !draft || saving) return;
    setSaving(true);
    try {
      const name = draft.name.trim();
      if (!name) {
        toast.error("Name is required");
        return;
      }
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ full_name: name, phone: draft.phone.trim() || null })
        .eq("id", user.id);
      if (pErr) throw pErr;

      if (identity.teacherRowId) {
        const { error: tErr } = await supabase
          .from("teachers")
          .update({
            full_name: name,
            mobile: draft.phone.trim() || null,
            email: draft.email.trim() || null,
            address: draft.address.trim() || null,
            qualification: draft.qualification.trim() || null,
          })
          .eq("id", identity.teacherRowId);
        if (tErr) {
          // The profiles update above already committed, so this is a partial
          // save, not a no-op â€” tell the user plainly instead of implying
          // nothing was saved, so they know to retry.
          await identity.reload();
          toast.error(
            `Name and phone were saved, but the rest of your teacher details could not be saved (${tErr.message}). Please try again.`,
          );
          return;
        }
      }

      await identity.reload();
      setEditing(false);
      showFlash("Profile updated successfully");
      toast.success("Profile updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (!pwdForm.next || pwdForm.next !== pwdForm.confirm || pwdSaving) return;
    setPwdSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwdForm.next });
      if (error) throw error;
      setChangePwdOpen(false);
      setPwdForm({ current: "", next: "", confirm: "" });
      showFlash("Password changed successfully");
      toast.success("Password updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setPwdSaving(false);
    }
  }

  if (identity.loading || !profile || !draft) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading profileâ€¦
      </div>
    );
  }

  const initials = teacherInitials(profile.name, "?");

  return (
    <div className="space-y-5 max-w-2xl">
      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#10b981]/15 border border-[#10b981]/25 text-[#10b981] text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}

      {!identity.linked && (
        <div className="px-4 py-3 rounded-xl bg-[#f59e0b]/10 border border-[#f59e0b]/25 text-[#f59e0b] text-xs">
          Your account isn&apos;t linked to a teacher record yet. Ask admin to link {user?.email ?? "your account"}.
        </div>
      )}

      <div className="bg-surface border border-border/70 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
          <span className="text-xl font-black text-black">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-black text-foreground">{profile.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {profile.subjects.length ? `${profile.subjects.join(" & ")} Teacher` : "Teacher"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {profile.employeeId} Â· {profile.department}
          </div>
          {profile.isClassTeacher && (
            <span className="inline-block mt-1 text-[9px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/10 px-2 py-0.5 rounded-full">
              Class Teacher â€” {profile.classTeacherOf?.className} {profile.classTeacherOf?.section}
            </span>
          )}
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(profile);
              setEditing(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-black bg-[#3b5bdb] hover:bg-[#d97706] transition-all shrink-0"
          >
            <Edit2 className="w-3.5 h-3.5" /> Edit Profile
          </button>
        ) : (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setDraft(profile);
                setEditing(false);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-muted-foreground bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-black bg-[#3b5bdb] hover:bg-[#d97706] transition-all disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
            </button>
          </div>
        )}
      </div>

      <Section title="Personal Information" icon={<User className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Full Name" value={editing ? draft.name : profile.name} editing={editing} onChange={(v) => d("name", v)} />
          </div>
          <Field
            label="Email Address"
            value={editing ? draft.email : profile.email}
            editing={editing}
            onChange={(v) => d("email", v)}
            type="email"
            disabled={!identity.teacherRowId}
            disabledHint="Can't save â€” account isn't linked to a teacher record. Ask admin to link it."
          />
          <Field
            label="Phone Number"
            value={editing ? draft.phone : profile.phone}
            editing={editing}
            onChange={(v) => d("phone", v)}
            type="tel"
          />
          <div className="col-span-2">
            <Field
              label="Home Address"
              value={editing ? draft.address : profile.address}
              editing={editing}
              onChange={(v) => d("address", v)}
              disabled={!identity.teacherRowId}
              disabledHint="Can't save â€” account isn't linked to a teacher record. Ask admin to link it."
            />
          </div>
        </div>
      </Section>

      <Section title="Professional Information" icon={<Briefcase className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Department" value={profile.department} editing={false} onChange={() => {}} />
          <Field label="Subjects" value={profile.subjects.join(", ") || "â€”"} editing={false} onChange={() => {}} />
          <Field
            label="Qualification"
            value={editing ? draft.qualification : profile.qualification}
            editing={editing}
            onChange={(v) => d("qualification", v)}
            disabled={!identity.teacherRowId}
            disabledHint="Can't save â€” account isn't linked to a teacher record. Ask admin to link it."
          />
          <Field label="Joined Date" value={profile.joinedDate || "â€”"} editing={false} onChange={() => {}} />
          <div className="col-span-2">
            <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Role</div>
            <div className="text-sm text-foreground">
              {profile.isClassTeacher ? (
                <span>
                  Class Teacher of{" "}
                  <span className="text-[#3b5bdb]">
                    {profile.classTeacherOf?.className} {profile.classTeacherOf?.section}
                  </span>
                  , Subject Teacher for all assigned classes
                </span>
              ) : (
                "Subject Teacher"
              )}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Linked Accounts" icon={<Link2 className="w-4 h-4" />}>
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted">
            <div className="w-8 h-8 rounded-lg bg-[#ea4335]/15 flex items-center justify-center">
              <Mail className="w-4 h-4 text-[#ea4335]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground">Google Account</div>
              <div className="text-[10px] text-muted-foreground">
                {profile.googleLinked ? profile.googleEmail : "Not linked via Google sign-in"}
              </div>
            </div>
            {profile.googleLinked ? (
              <span className="text-[9px] font-bold text-[#10b981] bg-[#10b981]/15 px-2 py-0.5 rounded-full">Linked</span>
            ) : (
              <span className="text-[9px] font-bold text-muted-foreground bg-white/5 px-2 py-0.5 rounded-full">Not linked</span>
            )}
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted">
            <div className="w-8 h-8 rounded-lg bg-[#10b981]/15 flex items-center justify-center">
              <Smartphone className="w-4 h-4 text-[#10b981]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground">Mobile Number</div>
              <div className="text-[10px] text-muted-foreground">{profile.phone || "Not set"}</div>
            </div>
            {profile.mobileLinked ? (
              <span className="text-[9px] font-bold text-[#10b981] bg-[#10b981]/15 px-2 py-0.5 rounded-full">On file</span>
            ) : (
              <span className="text-[9px] font-bold text-muted-foreground bg-white/5 px-2 py-0.5 rounded-full">Not set</span>
            )}
          </div>
        </div>
      </Section>

      <Section title="Security" icon={<Shield className="w-4 h-4" />}>
        <div className="flex items-center justify-between p-3 rounded-xl bg-muted">
          <div>
            <div className="text-xs font-semibold text-foreground">Password</div>
            <div className="text-[10px] text-muted-foreground">Update your sign-in password</div>
          </div>
          <button
            type="button"
            onClick={() => setChangePwdOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#3b5bdb] bg-[#3b5bdb]/10 hover:bg-[#3b5bdb]/15 transition-all"
          >
            <Lock className="w-3.5 h-3.5" /> Change
          </button>
        </div>
      </Section>

      {changePwdOpen && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setChangePwdOpen(false)} />
          <div className="relative z-10 bg-surface border border-border rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-foreground">Change Password</div>
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
                  className="bg-white/5 border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#3b5bdb]/40"
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
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void changePassword()}
                disabled={!pwdForm.next || pwdForm.next !== pwdForm.confirm || pwdSaving}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all"
              >
                {pwdSaving ? "Savingâ€¦" : "Change Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
