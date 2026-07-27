import { useState } from "react";
import {
  User, Mail, Lock, Link2, Link2Off,
  Edit2, Save, X, Check, Smartphone, Shield, Briefcase,
} from "lucide-react";
import { teacherProfile, type TeacherProfile } from "./data";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/7">
        <div className="w-8 h-8 rounded-xl bg-[#f59e0b]/15 flex items-center justify-center text-[#f59e0b]">{icon}</div>
        <div className="text-sm font-bold text-white">{title}</div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, value, editing, onChange, type = "text" }: { label: string; value: string; editing: boolean; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">{label}</label>
      {editing ? (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
          className="bg-white/5 border border-[#f59e0b]/30 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#f59e0b]/60 transition-all" />
      ) : (
        <div className="text-sm text-white px-0.5">{value || <span className="text-[#46465a]">Not set</span>}</div>
      )}
    </div>
  );
}

export default function TeacherProfile() {
  const [profile, setProfile] = useState<TeacherProfile>(teacherProfile);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TeacherProfile>(teacherProfile);
  const [flash, setFlash] = useState<string | null>(null);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: "", next: "", confirm: "" });

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }

  function d(key: keyof TeacherProfile, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#10b981]/15 border border-[#10b981]/25 text-[#10b981] text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}

      {/* Avatar card */}
      <div className="bg-[#131316] border border-white/7 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#f59e0b] to-[#d97706] flex items-center justify-center shrink-0">
          <span className="text-xl font-black text-black">AR</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-black text-white">{profile.name}</div>
          <div className="text-xs text-[#78788c] mt-0.5">{profile.subjects.join(" & ")} Teacher</div>
          <div className="text-[10px] text-[#46465a] mt-0.5">{profile.employeeId} · {profile.department}</div>
          {profile.isClassTeacher && (
            <span className="inline-block mt-1 text-[9px] font-bold text-[#f59e0b] bg-[#f59e0b]/10 px-2 py-0.5 rounded-full">
              Class Teacher — {profile.classTeacherOf?.className} {profile.classTeacherOf?.section}
            </span>
          )}
        </div>
        {!editing ? (
          <button onClick={() => { setDraft(profile); setEditing(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-black bg-[#f59e0b] hover:bg-[#d97706] transition-all shrink-0">
            <Edit2 className="w-3.5 h-3.5" /> Edit Profile
          </button>
        ) : (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => { setDraft(profile); setEditing(false); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10 transition-all">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button onClick={() => { setProfile(draft); setEditing(false); showFlash("Profile updated successfully"); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-black bg-[#f59e0b] hover:bg-[#d97706] transition-all">
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        )}
      </div>

      {/* Personal Info */}
      <Section title="Personal Information" icon={<User className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Full Name" value={editing ? draft.name : profile.name} editing={editing} onChange={(v) => d("name", v)} />
          </div>
          <Field label="Email Address" value={editing ? draft.email : profile.email} editing={editing} onChange={(v) => d("email", v)} type="email" />
          <Field label="Phone Number" value={editing ? draft.phone : profile.phone} editing={editing} onChange={(v) => d("phone", v)} type="tel" />
          <div className="col-span-2">
            <Field label="Home Address" value={editing ? draft.address : profile.address} editing={editing} onChange={(v) => d("address", v)} />
          </div>
        </div>
      </Section>

      {/* Professional Info */}
      <Section title="Professional Information" icon={<Briefcase className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Department" value={profile.department} editing={false} onChange={() => {}} />
          <Field label="Subjects" value={profile.subjects.join(", ")} editing={false} onChange={() => {}} />
          <Field label="Qualification" value={editing ? draft.qualification : profile.qualification} editing={editing} onChange={(v) => d("qualification", v)} />
          <Field label="Joined Date" value={profile.joinedDate} editing={false} onChange={() => {}} />
          <div className="col-span-2">
            <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider mb-1.5">Role</div>
            <div className="text-sm text-white">
              {profile.isClassTeacher ? (
                <span>Class Teacher of <span className="text-[#f59e0b]">{profile.classTeacherOf?.className} {profile.classTeacherOf?.section}</span>, Subject Teacher for all assigned classes</span>
              ) : "Subject Teacher"}
            </div>
          </div>
        </div>
      </Section>

      {/* Linked Accounts */}
      <Section title="Linked Accounts" icon={<Link2 className="w-4 h-4" />}>
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/3">
            <div className="w-8 h-8 rounded-lg bg-[#ea4335]/15 flex items-center justify-center">
              <Mail className="w-4 h-4 text-[#ea4335]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white">Google Account</div>
              <div className="text-[10px] text-[#78788c]">{profile.googleLinked ? profile.googleEmail : "Not linked"}</div>
            </div>
            {profile.googleLinked ? (
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold text-[#10b981] bg-[#10b981]/15 px-2 py-0.5 rounded-full">Linked</span>
                <button onClick={() => { setProfile((p) => ({ ...p, googleLinked: false })); showFlash("Google account unlinked"); }}
                  className="text-[10px] text-[#cc5069] hover:underline flex items-center gap-0.5">
                  <Link2Off className="w-3 h-3" /> Remove
                </button>
              </div>
            ) : (
              <button onClick={() => { setProfile((p) => ({ ...p, googleLinked: true, googleEmail: "ananya.rajan@gmail.com" })); showFlash("Google account linked"); }}
                className="text-[10px] text-[#f59e0b] hover:underline flex items-center gap-0.5">
                <Link2 className="w-3 h-3" /> Link
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/3">
            <div className="w-8 h-8 rounded-lg bg-[#10b981]/15 flex items-center justify-center">
              <Smartphone className="w-4 h-4 text-[#10b981]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white">Mobile Number</div>
              <div className="text-[10px] text-[#78788c]">{profile.mobileLinked ? profile.phone : "Not linked"}</div>
            </div>
            {profile.mobileLinked ? (
              <span className="text-[9px] font-bold text-[#10b981] bg-[#10b981]/15 px-2 py-0.5 rounded-full">Verified</span>
            ) : (
              <button onClick={() => { setProfile((p) => ({ ...p, mobileLinked: true })); showFlash("Mobile number linked"); }}
                className="text-[10px] text-[#f59e0b] hover:underline flex items-center gap-0.5">
                <Link2 className="w-3 h-3" /> Link
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* Security */}
      <Section title="Security" icon={<Shield className="w-4 h-4" />}>
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/3">
          <div>
            <div className="text-xs font-semibold text-white">Password</div>
            <div className="text-[10px] text-[#78788c]">Last changed 2 months ago</div>
          </div>
          <button onClick={() => setChangePwdOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#f59e0b] bg-[#f59e0b]/10 hover:bg-[#f59e0b]/15 transition-all">
            <Lock className="w-3.5 h-3.5" /> Change
          </button>
        </div>
      </Section>

      {/* Change Password Modal */}
      {changePwdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setChangePwdOpen(false)} />
          <div className="relative z-10 bg-[#131316] border border-white/10 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-white">Change Password</div>
              <button onClick={() => setChangePwdOpen(false)} className="text-[#78788c] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {[
              { label: "Current Password", key: "current" as const },
              { label: "New Password", key: "next" as const },
              { label: "Confirm New Password", key: "confirm" as const },
            ].map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">{f.label}</label>
                <input type="password" value={pwdForm[f.key]} onChange={(e) => setPwdForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#f59e0b]/40" />
              </div>
            ))}
            {pwdForm.next && pwdForm.confirm && pwdForm.next !== pwdForm.confirm && (
              <div className="text-[10px] text-[#cc5069]">Passwords do not match</div>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setChangePwdOpen(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5">Cancel</button>
              <button
                onClick={() => { setChangePwdOpen(false); setPwdForm({ current: "", next: "", confirm: "" }); showFlash("Password changed successfully"); }}
                disabled={!pwdForm.current || !pwdForm.next || pwdForm.next !== pwdForm.confirm}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-black bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-40 transition-all">
                Change Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
