import { useEffect, useState } from "react";
import {
  User, Mail, Lock, Link2,
  Edit2, Save, X, Check, Smartphone, Shield, Briefcase, Loader2, LogOut,
  ClipboardList,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useTeacherIdentity, teacherInitials } from "./useTeacherIdentity";
import { TestService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { displaySubject } from "@/lib/presentation";
import type { TeacherProfile } from "./data";
import { toErrorMessage } from "@/lib/presentation";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border/70 rounded-[2px] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border/70">
        <div className="w-8 h-8 rounded-[2px] bg-primary/15 flex items-center justify-center text-primary">{icon}</div>
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
   * teacher record) — shown read-only with an explanation instead of
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
          className="bg-muted border border-primary/30 rounded-[2px] px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 transition-all"
        />
      ) : (
        <div className="text-sm text-foreground px-0.5" title={editing && disabled ? disabledHint : undefined}>
          {value || <span className="text-muted-foreground">Not set</span>}
          {editing && disabled && disabledHint && (
            <span className="block text-[9px] text-warning mt-0.5 font-normal normal-case">{disabledHint}</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What this teacher has set, on their own profile.
 *
 * The profile carried their name, subjects, linked accounts and a password
 * form, and said nothing about their work. Both reads are their own rows —
 * `can_read_test_row` admits the author, `test_attempts_staff_read` admits
 * attempts on tests they created — so there is no fence here to get wrong.
 */
function TestsSetSection() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["test", "profile"]);
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof TestService.summaryForTeacher>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await TestService.summaryForTeacher(ctx, { limit: 5 });
        if (!cancelled) {
          setSummary(next);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Could not load the tests you have set"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  return (
    <Section title="Tests You Have Set" icon={<ClipboardList className="w-4 h-4" />}>
      {error ? (
        <div className="text-xs text-muted-foreground">{error}</div>
      ) : !summary ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your tests…
        </div>
      ) : summary.total === 0 ? (
        <div className="text-xs text-muted-foreground">
          You have not set a test yet. Open a class and use Create Test.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Tests set", value: summary.total },
              { label: "Live now", value: summary.published },
              { label: "Papers handed in", value: summary.submissions },
            ].map((s) => (
              <div key={s.label} className="rounded-[2px] bg-muted/60 px-3 py-2">
                <div className="text-lg font-black tabular-nums text-foreground">{s.value}</div>
                <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            {summary.recent.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-[2px] bg-muted/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-xs text-foreground truncate">{t.title}</div>
                  <div className="text-[9px] text-muted-foreground">
                    {[t.subject ? displaySubject(t.subject) : null, t.status]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground shrink-0">
                  {t.status === "published"
                    ? `${t.submittedCount} handed in`
                    : t.status === "draft"
                      ? "not published"
                      : t.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

export default function TeacherProfile() {
  const { user, signOut } = useAuth();
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
          // save, not a no-op — tell the user plainly instead of implying
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
      toast.error(toErrorMessage(e, "Could not save profile"));
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
      toast.error(toErrorMessage(e, "Could not change password"));
    } finally {
      setPwdSaving(false);
    }
  }

  if (identity.loading || !profile || !draft) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading profile…
      </div>
    );
  }

  const initials = teacherInitials(profile.name, "?");

  return (
    <div className="space-y-5 max-w-2xl">
      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-success/15 border border-success/25 text-success text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}

      {!identity.linked && (
        <div className="px-4 py-3 rounded-[2px] bg-warning/10 border border-warning/25 text-warning text-xs">
          Your account isn&apos;t linked to a teacher record yet. Ask admin to link {user?.email ?? "your account"}.
        </div>
      )}

      <div className="bg-surface border border-border/70 rounded-[2px] p-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-[2px] bg-primary flex items-center justify-center shrink-0">
          <span className="text-xl font-black text-primary-foreground">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-black text-foreground">{profile.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {profile.subjects.length ? `${profile.subjects.join(" & ")} Teacher` : "Teacher"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {profile.employeeId} · {profile.department}
          </div>
          {profile.isClassTeacher && (
            <span className="inline-block mt-1 text-[9px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              Class Teacher — {profile.classTeacherOf?.className} {profile.classTeacherOf?.section}
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
            className="flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-semibold text-primary-foreground bg-primary hover:opacity-80 transition-all shrink-0"
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
              className="flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold text-secondary-foreground bg-secondary hover:bg-secondary/80 transition-all"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold text-primary-foreground bg-primary hover:opacity-80 transition-all disabled:opacity-40"
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
            disabledHint="Can't save — account isn't linked to a teacher record. Ask admin to link it."
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
              disabledHint="Can't save — account isn't linked to a teacher record. Ask admin to link it."
            />
          </div>
        </div>
      </Section>

      <Section title="Professional Information" icon={<Briefcase className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Department" value={profile.department} editing={false} onChange={() => {}} />
          <Field label="Subjects" value={profile.subjects.join(", ") || "—"} editing={false} onChange={() => {}} />
          <Field
            label="Qualification"
            value={editing ? draft.qualification : profile.qualification}
            editing={editing}
            onChange={(v) => d("qualification", v)}
            disabled={!identity.teacherRowId}
            disabledHint="Can't save — account isn't linked to a teacher record. Ask admin to link it."
          />
          <Field label="Joined Date" value={profile.joinedDate || "—"} editing={false} onChange={() => {}} />
          <div className="col-span-2">
            <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Role</div>
            <div className="text-sm text-foreground">
              {profile.isClassTeacher ? (
                <span>
                  Class Teacher of{" "}
                  <span className="text-primary">
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

      <TestsSetSection />

      <Section title="Linked Accounts" icon={<Link2 className="w-4 h-4" />}>
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-[2px] bg-card border border-border">
            <div className="w-8 h-8 rounded-lg bg-destructive/15 flex items-center justify-center">
              <Mail className="w-4 h-4 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground">Google Account</div>
              <div className="text-[10px] text-muted-foreground">
                {profile.googleLinked ? profile.googleEmail : "Not linked via Google sign-in"}
              </div>
            </div>
            {profile.googleLinked ? (
              <span className="text-[9px] font-bold text-success bg-success/15 px-2 py-0.5 rounded-full">Linked</span>
            ) : (
              <span className="text-[9px] font-bold text-muted-foreground border border-border px-2 py-0.5 rounded-full">Not linked</span>
            )}
          </div>

          <div className="flex items-center gap-3 p-3 rounded-[2px] bg-card border border-border">
            <div className="w-8 h-8 rounded-lg bg-success/15 flex items-center justify-center">
              <Smartphone className="w-4 h-4 text-success" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground">Mobile Number</div>
              <div className="text-[10px] text-muted-foreground">{profile.phone || "Not set"}</div>
            </div>
            {profile.mobileLinked ? (
              <span className="text-[9px] font-bold text-success bg-success/15 px-2 py-0.5 rounded-full">On file</span>
            ) : (
              <span className="text-[9px] font-bold text-muted-foreground border border-border px-2 py-0.5 rounded-full">Not set</span>
            )}
          </div>
        </div>
      </Section>

      <Section title="Security" icon={<Shield className="w-4 h-4" />}>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-[2px] bg-card border border-border">
            <div>
              <div className="text-xs font-semibold text-foreground">Password</div>
              <div className="text-[10px] text-muted-foreground">Update your sign-in password</div>
            </div>
            <button
              type="button"
              onClick={() => setChangePwdOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/15 transition-all"
            >
              <Lock className="w-3.5 h-3.5" /> Change
            </button>
          </div>

          {/* Sign out belongs here as well as on the rail. The rail's copy is
              the only one that existed, and Profile is where someone looks for
              it — the same reason it sits under Security rather than in a
              section of its own: it ends a session. */}
          <div className="flex items-center justify-between p-3 rounded-[2px] bg-card border border-border">
            <div>
              <div className="text-xs font-semibold text-foreground">Sign out</div>
              <div className="text-[10px] text-muted-foreground">End this session on this device</div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold text-destructive bg-destructive/10 hover:bg-destructive/15 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          </div>
        </div>
      </Section>

      {changePwdOpen && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setChangePwdOpen(false)} />
          <div className="relative z-10 bg-surface border border-border rounded-[2px] w-full max-w-sm p-5 shadow-2xl space-y-4">
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
                  className="bg-muted border border-border rounded-[2px] px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40"
                />
              </div>
            ))}
            {pwdForm.next && pwdForm.confirm && pwdForm.next !== pwdForm.confirm && (
              <div className="text-[10px] text-destructive">Passwords do not match</div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setChangePwdOpen(false)}
                className="px-4 py-2 rounded-[2px] text-xs font-semibold text-secondary-foreground bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void changePassword()}
                disabled={!pwdForm.next || pwdForm.next !== pwdForm.confirm || pwdSaving}
                className="px-4 py-2 rounded-[2px] text-xs font-semibold text-primary-foreground bg-primary hover:opacity-80 disabled:opacity-40 transition-all"
              >
                {pwdSaving ? "Saving…" : "Change Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
