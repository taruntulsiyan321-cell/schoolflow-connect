/**
 * Account linking panel â€” honest empty / not-wired state only.
 * Never pretends Google/mobile link, activation, or status changes succeeded.
 */

import { Mail, Smartphone, Lock, Send } from "lucide-react";

interface AccountLinkingProps {
  entityName: string;
  entityType: "student" | "teacher" | "parent";
  status: string;
}

export function AccountLinkingPanel({ entityName, entityType, status }: AccountLinkingProps) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Account linking for {entityName} ({entityType}) is not wired on this panel.
        Use Students / Teachers admin pages for live portal linking RPCs. Status shown: {status || "â€”"}.
      </p>

      <div className="p-3 rounded-xl bg-muted space-y-2 opacity-60">
        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Google Account</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mail className="w-3.5 h-3.5" /> Not available here
        </div>
      </div>

      <div className="p-3 rounded-xl bg-muted space-y-2 opacity-60">
        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Mobile Number</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Smartphone className="w-3.5 h-3.5" /> Not available here
        </div>
      </div>

      <div className="space-y-2 opacity-50 pointer-events-none">
        <div className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold bg-white/5 text-muted-foreground">
          <Send className="w-3.5 h-3.5" /> Send Activation Invitation
        </div>
        <div className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold bg-white/5 text-muted-foreground">
          <Lock className="w-3.5 h-3.5" /> Reset Password
        </div>
      </div>
    </div>
  );
}
