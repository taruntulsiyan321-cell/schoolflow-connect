import { MessageSquare } from "lucide-react";

/**
 * Parent messages — no MessageService yet.
 * Honest empty state only; never invent threads or claim send success.
 */
export default function ParentMessages() {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-bold text-white">Messages</div>
        <div className="text-[10px] text-[#78788c] mt-0.5">
          Direct messaging is not connected yet
        </div>
      </div>
      <div className="bg-[#131316] border border-white/7 rounded-2xl flex flex-col items-center justify-center gap-3 text-center p-12 min-h-[360px]">
        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-[#46465a]" />
        </div>
        <div className="text-sm font-semibold text-white">No conversations</div>
        <div className="text-xs text-[#78788c] max-w-sm">
          Parent–teacher messaging will appear here once the messaging service is live.
          Academic notices are available under Announcements.
        </div>
      </div>
    </div>
  );
}
