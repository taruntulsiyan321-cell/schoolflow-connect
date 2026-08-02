import { useEffect, useState } from "react";
import {
  User, Mail, Lock, Link2, Link2Off,
  Edit2, Save, X, Check, Smartphone, Shield,
} from "lucide-react";
import { type ParentProfile } from "./data";
import { useAuth } from "@/hooks/useAuth";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/7">
        <div className="w-8 h-8 rounded-xl bg-[#3b5bdb]/15 flex items-center justify-center text-[#3b5bdb]">{icon}</div>
        <div className="text-sm font-bold text-white">{title}</div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function EditableField({ label, value, editing, onChange, type = "text" }: { label: string; value: string; editing: boolean; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">{label}</label>
      {editing ? (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
          className="bg-white/5 border border-[#3b5bdb]/30 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#3b5bdb]/60 transition-all" />
      ) : (
        <div className="text-sm text-white px-0.5">{value || <span className="text-[#46465a]">Not set</span>}</div>
      )}
    </div>
  );
}

function profileFromAuth(fullName: string, email: string | null): ParentProfile {
  return {
    name: fullName || "Parent",
    email: email ?? "",
    phone: "",
    occupation: "",
    address: "",
    relationship: "",
    googleLinked: false,
    googleEmail: "",
    mobileLinked: false,
  };
}

export default function ParentProfilePage() {
  const { profile: authProfile } = useAuth();
  const seeded = profileFromAuth(authProfile?.fullName ?? "", authProfile?.email ?? null);
  const [profile, setProfile] = useState<ParentProfile>(seeded);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ParentProfile>(seeded);
  const [flash, setFlash] = useState<string | null>(null);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: "", next: "", confirm: "" });

  useEffect(() => {
    const next = profileFromAuth(authProfile?.fullName ?? "", authProfile?.email ?? null);
    setProfile((prev) => ({
      ...prev,
      name: next.name,
      email: next.email || prev.email,
    }));
  }, [authProfile?.fullName, authProfile?.email]);

  function startEdit() {
    setDraft(profile);
    setEditing(true);
  }

  function saveEdit() {
    setProfile(draft);
    setEditing(false);
    showFlash("Local profile draft saved (account name comes from auth)");
  }

  function cancelEdit() {
    setDraft(profile);
    setEditing(false);
  }

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }

  function handleChangePwd() {
    if (!pwdForm.current || !pwdForm.next) return;
    if (pwdForm.next !== pwdForm.confirm) return;
    setChangePwdOpen(false);
    setPwdForm({ current: "", next: "", confirm: "" });
    showFlash("Use account settings / auth provider to change password");
  }

  function d(key: keyof ParentProfile, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const initials = (profile.name || "P").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "P";

  return (
    <div className="space-y-5 max-w-2xl">
      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#3b5bdb]/15 border border-[#3b5bdb]/25 text-[#3b5bdb] text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}

      <div className="bg-[#131316] border border-white/7 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
          <span className="text-xl font-black text-white">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-black text-white">{profile.name || "Parent"}</div>
          <div className="text-xs text-[#78788c] mt-0.5">{profile.relationship || "Guardian"}{profile.occupation ? ` · ${profile.occupation}` : ""}</div>
          <div className="text-[10px] text-[#46465a]">{profile.email || "No email on profile"}</div>
        </div>
        {!editing ? (
          <button onClick={startEdit}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#3b5bdb] hover:bg-[#6882e8] transition-all shrink-0">
            <Edit2 className="w-3.5 h-3.5" /> Edit Profile
          </button>
        ) : (
          <div className="flex gap-2 shrink-0">
            <button onClick={cancelEdit} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10 transition-all">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button onClick={saveEdit} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-[#3b5bdb] hover:bg-[#6882e8] transition-all">
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        )}
      </div>

      <Section title="Personal Information" icon={<User className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <EditableField label="Full Name" value={editing ? draft.name : profile.name} editing={editing} onChange={(v) => d("name", v)} />
          </div>
          <EditableField label="Email Address" value={editing ? draft.email : profile.email} editing={editing} onChange={(v) => d("email", v)} type="email" />
          <EditableField label="Phone Number" value={editing ? draft.phone : profile.phone} editing={editing} onChange={(v) => d("phone", v)} type="tel" />
          <EditableField label="Occupation" value={editing ? draft.occupation : profile.occupation} editing={editing} onChange={(v) => d("occupation", v)} />
          <EditableField label="Relationship to Child" value={editing ? draft.relationship : profile.relationship} editing={editing} onChange={(v) => d("relationship", v)} />
          <div className="col-span-2">
            <EditableField label="Home Address" value={editing ? draft.address : profile.address} editing={editing} onChange={(v) => d("address", v)} />
          </div>
        </div>
      </Section>

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
                <span className="text-[9px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/15 px-2 py-0.5 rounded-full">Linked</span>
                <button onClick={() => { setProfile((p) => ({ ...p, googleLinked: false })); showFlash("Google account unlinked locally"); }}
                  className="text-[10px] text-[#cc5069] hover:underline flex items-center gap-0.5">
                  <Link2Off className="w-3 h-3" /> Remove
                </button>
              </div>
            ) : (
              <span className="text-[10px] text-[#46465a]">Link via auth provider</span>
            )}
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/3">
            <div className="w-8 h-8 rounded-lg bg-[#3b5bdb]/15 flex items-center justify-center">
              <Smartphone className="w-4 h-4 text-[#3b5bdb]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white">Mobile Number</div>
              <div className="text-[10px] text-[#78788c]">{profile.mobileLinked ? profile.phone || "Verified" : "Not linked"}</div>
            </div>
            {profile.mobileLinked ? (
              <span className="text-[9px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/15 px-2 py-0.5 rounded-full">Verified</span>
            ) : (
              <span className="text-[10px] text-[#46465a]">Not verified</span>
            )}
          </div>
        </div>
      </Section>

      <Section title="Security" icon={<Shield className="w-4 h-4" />}>
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/3">
          <div>
            <div className="text-xs font-semibold text-white">Password</div>
            <div className="text-[10px] text-[#78788c]">Managed by authentication provider</div>
          </div>
          <button onClick={() => setChangePwdOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#c08a3a] bg-[#c08a3a]/10 hover:bg-[#c08a3a]/15 transition-all">
            <Lock className="w-3.5 h-3.5" /> Change
          </button>
        </div>
      </Section>

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
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#3b5bdb]/40" />
              </div>
            ))}
            {pwdForm.next && pwdForm.confirm && pwdForm.next !== pwdForm.confirm && (
              <div className="text-[10px] text-[#cc5069]">Passwords do not match</div>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setChangePwdOpen(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10 transition-all">
                Cancel
              </button>
              <button onClick={handleChangePwd}
                disabled={!pwdForm.current || !pwdForm.next || pwdForm.next !== pwdForm.confirm}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#3b5bdb] hover:bg-[#6882e8] disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                Change Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
