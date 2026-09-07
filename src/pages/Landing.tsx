/**
 * Guest marketing homepage → full Gurukul landing.
 * Hard-navigate so the document title/URL are the landing page,
 * not the SPA shell ("Vidyalaya — School Management Platform").
 */
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export default function Landing(_props: { noRoleBanner?: boolean } = {}) {
  useEffect(() => {
    window.location.replace("/landing.html");
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#FAFBFC]">
      <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
      <p className="text-sm text-slate-500">Loading Gurukul…</p>
    </div>
  );
}
