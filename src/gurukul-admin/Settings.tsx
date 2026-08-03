import { useState, useEffect } from "react";
import {
  Save, X, School, Image, AlertTriangle, Loader2, Check,
} from "lucide-react";
import { cn } from "./shared";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface SchoolSettings {
  schoolName: string;
  logoUrl: string;
  board: string;
  stream: string;
}

const EMPTY: SchoolSettings = {
  schoolName: "",
  logoUrl: "",
  board: "",
  stream: "",
};

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

/**
 * Admin settings — loads/saves the real `schools` row for this tenant.
 * No fields beyond what the schools table actually stores; no fake "saved" toast
 * unless the Supabase update actually succeeds.
 */
export default function Settings() {
  const { schoolId } = useAuth();
  const [saved, setSaved] = useState<SchoolSettings>(EMPTY);
  const [form, setForm] = useState<SchoolSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => {
    if (!schoolId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from("schools")
        .select("name, logo_url, board, stream")
        .eq("id", schoolId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      const loaded: SchoolSettings = {
        schoolName: data?.name ?? "",
        logoUrl: data?.logo_url ?? "",
        board: data?.board ?? "",
        stream: data?.stream ?? "",
      };
      setSaved(loaded);
      setForm(loaded);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  function set(key: keyof SchoolSettings, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!schoolId) {
      setSaveError("No school linked to this account.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const { error } = await supabase
      .from("schools")
      .update({
        name: form.schoolName.trim(),
        logo_url: form.logoUrl.trim() || null,
        board: form.board.trim() || null,
        stream: form.stream.trim() || null,
      })
      .eq("id", schoolId);
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setSaved(form);
    setToast("Settings saved");
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading school settings…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="text-sm text-[#cc5069] py-16 text-center">
        Failed to load school settings: {loadError}
      </div>
    );
  }

  if (!schoolId) {
    return (
      <div className="text-sm text-[#78788c] py-16 text-center">
        No school linked to this account. Settings unavailable.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-bold text-white">School Settings</div>
          <div className="text-xs text-[#78788c] mt-0.5">Manage your school's basic information</div>
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
          <button onClick={() => void handleSave()} disabled={!isDirty || saving}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
              isDirty && !saving ? "text-white bg-[#3b5bdb] hover:bg-[#2f4fc4]" : "text-[#46465a] bg-white/5 cursor-not-allowed")}>
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving…" : isDirty ? "Save Changes" : "All Saved"}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#cc5069]/15 border border-[#cc5069]/25 text-[#cc5069] text-xs font-semibold">
          Failed to save: {saveError}
        </div>
      )}

      <Section title="School Identity" icon={<School className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="School Name">
              <input value={form.schoolName} onChange={(e) => set("schoolName", e.target.value)} className={inputCls} placeholder="e.g. Gurukul International School" />
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="School Logo URL" hint="Paste a hosted image URL. The logo will appear across the platform.">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                  {form.logoUrl ? (
                    <img src={form.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center">
                      <Image className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>
                <input value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} className={inputCls} placeholder="https://…" />
              </div>
            </Field>
          </div>

          <div>
            <Field label="Board">
              <input value={form.board} onChange={(e) => set("board", e.target.value)} className={inputCls} placeholder="e.g. CBSE" />
            </Field>
          </div>

          <div>
            <Field label="Stream">
              <input value={form.stream} onChange={(e) => set("stream", e.target.value)} className={inputCls} placeholder="e.g. Science, Commerce" />
            </Field>
          </div>
        </div>
      </Section>

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
            <button onClick={() => void handleSave()} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {showUnsavedWarning && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
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

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-[#4aa87a]/15 border border-[#4aa87a]/25 text-[#4aa87a] text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {toast}
        </div>
      )}

      {isDirty && <div className="h-16" />}
    </div>
  );
}
