import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Brain, Maximize2, X } from "lucide-react";
import AICoach from "@/gurukul/pages/AICoach";
import { cn } from "@/gurukul/components/shared";

/**
 * Nova on every screen (docs/TODO.md D2): a button that opens Nova beside the
 * page, so a student can ask without leaving what they are reading.
 *
 * It is Nova itself, `AICoach embedded`, with the same conversations as the
 * AI Coach page, never a second chat. Layout renders it outside the page area,
 * which re-mounts on every navigation, so a conversation and a reply in flight
 * carry across screens. Once opened it stays mounted while closed, for the same
 * reason.
 *
 * Where it is not:
 *   - during a mock paper. The paper renders without the app shell
 *     (StudentDashboard's isSittingAMock), so Nova cannot answer its questions.
 *   - on AI Coach, which is Nova. Layout does not render it there, so two
 *     Novas never write the same conversations at once.
 */
export function NovaPopup() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    // Closing hands focus back to the button, which only exists again once
    // the panel has closed.
    if (!open) {
      if (wasOpen.current) buttonRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    // Straight to the composer, so opening Nova is one step from asking.
    const focus = setTimeout(() => panelRef.current?.querySelector<HTMLElement>("textarea")?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(focus);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const show = () => {
    setMounted(true);
    setOpen(true);
  };

  return (
    <>
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          onClick={show}
          aria-label="Ask Nova"
          aria-expanded={false}
          aria-controls="nova-popup"
          className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:right-6 md:bottom-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Brain className="h-5 w-5" aria-hidden />
        </button>
      )}
      {mounted && (
        <div
          id="nova-popup"
          ref={panelRef}
          role="dialog"
          aria-label="Nova"
          className={cn(
            // Closed, it stays mounted but is not drawn (display: none also
            // takes it out of the accessibility tree).
            open ? "flex" : "hidden",
            "fixed z-50 flex-col overflow-hidden bg-card",
            // A phone: the whole screen. Wider: a panel beside the page.
            "inset-0 md:inset-auto md:right-6 md:bottom-6 md:h-[min(40rem,calc(100vh-6rem))] md:w-[26rem] md:rounded-2xl md:border md:border-border md:shadow-2xl",
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:pt-2">
            <span className="flex-1 text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>Nova</span>
            <Link
              to="/student/aicoach"
              onClick={() => setOpen(false)}
              className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden /> Open AI Coach
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Nova"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 pb-[env(safe-area-inset-bottom)] md:pb-0">
            <AICoach embedded />
          </div>
        </div>
      )}
    </>
  );
}
