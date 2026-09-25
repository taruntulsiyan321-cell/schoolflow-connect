import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { RecoveryEngineService, useAcademicContext, type ClearAnywayOutcome } from "@/academic";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toErrorMessage } from "@/lib/presentation";

/**
 * §4.4 — "the student decides, the app advises".
 *
 * Shown under a NOT READY recovery verdict. Clearing is allowed — "not a
 * block, a speed bump" — so the button is here, and the bump is the confirm:
 * it says plainly that the check found the chapter not solid, what clearing
 * does, and that a revision check in a week will bring it back if it did not
 * stick. The server decides everything else (which session, what is cleared,
 * the revision date); this screen only relays the choice.
 */
export function RecoveryClearAnyway({ sessionId }: { sessionId: string }) {
  const { ctx } = useAcademicContext();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ClearAnywayOutcome | null>(null);

  async function clear() {
    if (!ctx || busy) return;
    setBusy(true);
    try {
      setDone(await RecoveryEngineService.clearChapterAfterRecovery(ctx, sessionId));
      setConfirming(false);
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not clear the chapter"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const when = done.already ? null : new Date(done.next_revision_at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return (
      <p role="status" className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
        <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-400" />
        <span>
          {done.already
            ? "This chapter is already marked recovered."
            : `Marked recovered — ${done.cleared} ${done.cleared === 1 ? "mistake" : "mistakes"} cleared. A revision check on ${when} will bring it back if it hasn't stuck.`}
        </span>
      </p>
    );
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)} disabled={!ctx}>
          Mark as recovered anyway
        </Button>
        <span className="text-[11px] text-muted-foreground">or open Recovery to try the next round.</span>
      </div>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear this chapter anyway?</DialogTitle>
            <DialogDescription>
              The check says this chapter isn't solid yet. If you clear it, its mistakes leave your mistake book
              and this score stays on record. A revision check in a week will bring the chapter back if it
              hasn't stuck.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Keep practising
            </Button>
            <Button onClick={() => void clear()} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Clear anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
