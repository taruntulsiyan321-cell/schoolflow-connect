import { useState, useEffect } from "react";
import {
  Save, X, School, Phone, Clock, Image, AlertTriangle,
} from "lucide-react";
import { cn, UndoToast } from "./shared";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SchoolSettings {
  schoolName: string;
  logoUrl: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  contactNumber: string;
  email: string;
  website: string;
  principalName: string;
  academicYear: string;
  schoolStartTime: string;
  schoolEndTime: string;
  workingDays: string[];
}

/** Empty defaults — never invent school identity; load from school profile when wired. */
const DEFAULT: SchoolSettings = {
  schoolName: "",
  logoUrl: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  contactNumber: "",
  email: "",
  website: "",
  principalName: "",
  academicYear: "",
  schoolStartTime: "",
  schoolEndTime: "",
  workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
};

const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ACADEMIC_YEARS = ["2024-25", "2025-26", "2026-27", "2027-28", "2028-29"];

// ── Section component ─────────────────────────────────────────────────────────

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

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">{label}</label>
      {children}
      {hint && <span className="text-[9px] text-[#46465a]">{hint}</span>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Settings() {
  const [saved, setSaved] = useState<SchoolSettings>(DEFAULT);
  const [form, setForm] = useState<SchoolSettings>(DEFAULT);
  const [toast, setToast] = useState<string | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => {}, [isDirty]);

  function set(key: keyof SchoolSettings, value: string | string[]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleDay(day: string) {
    setForm((f) => ({
      ...f,
      workingDays: f.workingDays.includes(day)
        ? f.workingDays.filter((d) => d !== day)
        : [...f.workingDays, day],
    }));
  }

  function handleSave() {
    setSaved(form);
    setToast("Settings saved successfully");
    setTimeout(() => setToast(null), 3000);
  }

  function handleCancel() {
    if (isDirty) setShowUnsavedWarning(true);
    else setForm(saved);
  }

  function confirmDiscard() {
    setForm(saved);
    setShowUnsavedWarning(false);
  }

  const inputCls = "bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#3b5bdb]/50 w-full";

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header with save / cancel */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-bold text-white">School Settings</div>
          <div className="text-xs text-[#78788c] mt-0.5">Manage your school's basic information and configuration</div>
        </div>
        <div className="flex items-center gap-3">
          {isDirty && (
            <>
              <div className="flex items-center gap-1.5 text-[10px] text-[#c08a3a]">
                <AlertTriangle className="w-3 h-3" /> Unsaved changes
              </div>
              <button onClick={handleCancel} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
                <X className="w-3.5 h-3.5" /> Discard
              </button>
            </>
          )}
          <button onClick={handleSave} disabled={!isDirty}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
              isDirty ? "text-white bg-[#3b5bdb] hover:bg-[#2f4fc4]" : "text-[#46465a] bg-white/5 cursor-not-allowed")}>
            <Save className="w-3.5 h-3.5" />
            {isDirty ? "Save Changes" : "All Saved"}
          </button>
        </div>
      </div>

      {/* School Identity */}
      <Section title="School Identity" icon={<School className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="School Name">
              <input value={form.schoolName} onChange={(e) => set("schoolName", e.target.value)} className={inputCls} placeholder="e.g. Gurukul International School" />
            </Field>
          </div>

          {/* Logo */}
          <div className="col-span-2">
            <Field label="School Logo" hint="Upload a PNG or SVG. The logo will appear across the platform.">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                  {form.logoUrl ? (
                    <img src={form.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center">
                      <span className="text-xs font-black text-white">G</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all cursor-pointer">
                    <Image className="w-3.5 h-3.5" /> Change Logo
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) set("logoUrl", URL.createObjectURL(file));
                      }} />
                  </label>
                  {form.logoUrl && (
                    <button onClick={() => set("logoUrl", "")} className="text-[10px] text-[#cc5069] hover:underline">Remove logo</button>
                  )}
                </div>
              </div>
            </Field>
          </div>

          <div>
            <Field label="Principal Name">
              <input value={form.principalName} onChange={(e) => set("principalName", e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div>
            <Field label="Academic Year">
              <select value={form.academicYear} onChange={(e) => set("academicYear", e.target.value)} className={inputCls}>
                {ACADEMIC_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </Section>

      {/* Contact Information */}
      <Section title="Contact Information" icon={<Phone className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Street Address">
              <input value={form.address} onChange={(e) => set("address", e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="City">
            <input value={form.city} onChange={(e) => set("city", e.target.value)} className={inputCls} />
          </Field>
          <Field label="State">
            <input value={form.state} onChange={(e) => set("state", e.target.value)} className={inputCls} />
          </Field>
          <Field label="PIN Code">
            <input value={form.pincode} onChange={(e) => set("pincode", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Contact Number">
            <input value={form.contactNumber} onChange={(e) => set("contactNumber", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Official Email">
            <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Website">
            <input type="url" value={form.website} onChange={(e) => set("website", e.target.value)} className={inputCls} />
          </Field>
        </div>
      </Section>

      {/* School Timings */}
      <Section title="School Timings" icon={<Clock className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="School Start Time">
            <input type="time" value={form.schoolStartTime} onChange={(e) => set("schoolStartTime", e.target.value)} className={inputCls} />
          </Field>
          <Field label="School End Time">
            <input type="time" value={form.schoolEndTime} onChange={(e) => set("schoolEndTime", e.target.value)} className={inputCls} />
          </Field>

          <div className="col-span-2">
            <Field label="Working Days">
              <div className="flex flex-wrap gap-2 mt-1">
                {ALL_DAYS.map((day) => (
                  <button key={day} onClick={() => toggleDay(day)}
                    className={cn("px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all",
                      form.workingDays.includes(day)
                        ? "bg-[#3b5bdb]/15 border-[#3b5bdb]/30 text-[#a5b4fc]"
                        : "bg-white/5 border-white/10 text-[#78788c] hover:text-white")}>
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </div>
      </Section>

      {/* Sticky save bar when dirty */}
      {isDirty && (
        <div className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between px-6 py-4 bg-[#0a0a0c]/95 border-t border-white/10 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-sm text-[#c08a3a]">
            <AlertTriangle className="w-4 h-4" />
            You have unsaved changes. Save before leaving this page.
          </div>
          <div className="flex gap-3">
            <button onClick={handleCancel} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
              Discard
            </button>
            <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
              <Save className="w-3.5 h-3.5" /> Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Unsaved changes warning */}
      {showUnsavedWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowUnsavedWarning(false)} />
          <div className="relative z-10 bg-[#131316] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-3 mb-2">
              <AlertTriangle className="w-5 h-5 text-[#c08a3a]" />
              <div className="text-sm font-bold text-white">Discard changes?</div>
            </div>
            <div className="text-xs text-[#78788c] mb-5">You have unsaved changes. Discarding will revert all fields to their last saved state.</div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowUnsavedWarning(false)} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
                Keep Editing
              </button>
              <button onClick={confirmDiscard} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#cc5069] hover:bg-[#b84460] transition-all">
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <UndoToast state={{ message: toast, type: "success" }} onClose={() => setToast(null)} />}

      {/* Bottom padding for sticky bar */}
      {isDirty && <div className="h-16" />}
    </div>
  );
}
