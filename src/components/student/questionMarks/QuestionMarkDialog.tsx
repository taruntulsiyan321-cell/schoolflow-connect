import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mic, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MathText } from "@/components/MathText";
import { cn } from "@/lib/utils";
import { toErrorMessage } from "@/lib/presentation";
import {
  NOTE_MAX_CHARS, VOICE_MAX_SECONDS, clampNote, countChars, formatClock, groupMarkTags, removeVoiceNotes, saveMark,
  uploadVoiceNote, type MarkTag, type MarkedQuestion, type QuestionMark, type QuestionRef,
} from "@/lib/questionMarks";
import { VOICE_RECORDER_MESSAGES, useVoiceNoteRecorder } from "./useVoiceNoteRecorder";
import { VoiceNotePlayer } from "./VoiceNotePlayer";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  questionRef: QuestionRef;
  question: MarkedQuestion;
  tags: MarkTag[];
  mark: QuestionMark | null;
  onSaved: (mark: QuestionMark | null) => void;
};

/**
 * Mark one question: tags in their groups, a note of up to NOTE_MAX_CHARS and
 * a voice note of up to VOICE_MAX_SECONDS. Saving nothing removes the mark.
 */
export function QuestionMarkDialog({ open, onOpenChange, userId, questionRef, question, tags, mark, onSaved }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [keepVoice, setKeepVoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const recorder = useVoiceNoteRecorder();
  const { discard } = recorder;

  // Every opening starts from what is stored, not from an abandoned edit.
  useEffect(() => {
    if (!open) return;
    setSelected(mark?.tags ?? []);
    setNote(mark?.note ?? "");
    setKeepVoice(Boolean(mark?.voicePath));
    discard();
  }, [open, mark, discard]);

  const groups = useMemo(() => groupMarkTags(tags, mark?.tags ?? []), [tags, mark]);
  const recording = recorder.state === "recording";
  const hasNewRecording = recorder.state === "recorded" && recorder.blob !== null;
  const hasVoice = hasNewRecording || (keepVoice && Boolean(mark?.voicePath));

  function toggle(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function persist(next: { tags: string[]; note: string; withVoice: boolean }) {
    setSaving(true);
    let uploaded: string | null = null;
    try {
      if (next.withVoice && hasNewRecording && recorder.blob) {
        uploaded = await uploadVoiceNote(userId, recorder.blob);
      }
      const voice = uploaded
        ? { path: uploaded, seconds: recorder.seconds }
        : next.withVoice && keepVoice && mark?.voicePath
          ? { path: mark.voicePath, seconds: mark.voiceSeconds ?? 1 }
          : null;
      let saved: QuestionMark | null;
      try {
        saved = await saveMark(userId, questionRef, question, { tags: next.tags, note: next.note, voice });
      } catch (e) {
        if (uploaded) await removeVoiceNotes([uploaded]);
        throw e;
      }
      // The old recording, once the mark no longer points at it.
      if (mark?.voicePath && mark.voicePath !== voice?.path) await removeVoiceNotes([mark.voicePath]);
      onSaved(saved);
      toast.success(saved ? "Mark saved" : "Mark removed");
      onOpenChange(false);
    } catch (e) {
      toast.error(toErrorMessage(e, "We couldn't save your mark. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const noteCount = countChars(note);
  const busy = saving || recording;

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mark this question</DialogTitle>
          <DialogDescription asChild>
            <div className="line-clamp-3 text-sm text-muted-foreground">
              <MathText text={question.text} />
            </div>
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby="mark-tags-heading" className="space-y-3">
          <h3 id="mark-tags-heading" className="text-sm font-semibold">Why did it go wrong?</h3>
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">The tags couldn't be loaded. You can still save a note.</p>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.tags.map((t) => {
                    const on = selected.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(t.key)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-muted text-foreground hover:bg-secondary",
                        )}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </section>

        <section className="space-y-1.5">
          <label htmlFor="mark-note" className="text-sm font-semibold">Note</label>
          <Textarea
            id="mark-note"
            value={note}
            onChange={(e) => setNote(clampNote(e.target.value))}
            placeholder="What will you do differently next time?"
            rows={3}
          />
          <div className={cn("text-right text-[11px] tabular-nums", noteCount >= NOTE_MAX_CHARS ? "text-destructive" : "text-muted-foreground")}>
            {noteCount}/{NOTE_MAX_CHARS}
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-sm font-semibold">Voice note <span className="font-normal text-muted-foreground">(up to {formatClock(VOICE_MAX_SECONDS)})</span></div>
          {keepVoice && mark?.voicePath && !hasNewRecording && !recording ? (
            <div className="flex flex-wrap items-center gap-2">
              <VoiceNotePlayer path={mark.voicePath} seconds={mark.voiceSeconds} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setKeepVoice(false)} disabled={saving}>
                <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Delete
              </Button>
            </div>
          ) : hasNewRecording && recorder.blob ? (
            <NewRecording blob={recorder.blob} seconds={recorder.seconds} onDiscard={discard} disabled={saving} />
          ) : !recorder.supported ? (
            <p className="text-xs text-muted-foreground">Voice notes aren't available in this browser.</p>
          ) : recording ? (
            <div className="flex items-center gap-3">
              <Button type="button" variant="destructive" size="sm" onClick={recorder.stop}>
                <Square className="mr-1 h-3.5 w-3.5" aria-hidden /> Stop
              </Button>
              <span className="text-sm tabular-nums text-muted-foreground" role="timer" aria-live="off">
                {formatClock(recorder.seconds)} / {formatClock(VOICE_MAX_SECONDS)}
              </span>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => void recorder.start()} disabled={saving}>
              <Mic className="mr-1 h-3.5 w-3.5" aria-hidden /> Record
            </Button>
          )}
          {recorder.error && <p className="text-xs text-destructive">{VOICE_RECORDER_MESSAGES[recorder.error]}</p>}
        </section>

        <DialogFooter className="gap-2 sm:gap-0">
          {mark && (
            <Button
              type="button"
              variant="ghost"
              className="sm:mr-auto"
              disabled={busy}
              onClick={() => void persist({ tags: [], note: "", withVoice: false })}
            >
              Remove mark
            </Button>
          )}
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || (!mark && selected.length === 0 && note.trim() === "" && !hasVoice)}
            onClick={() => void persist({ tags: selected, note, withVoice: true })}
          >
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewRecording({ blob, seconds, onDiscard, disabled }: { blob: Blob; seconds: number; onDiscard: () => void; disabled: boolean }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <audio controls src={url} className="h-9 w-full max-w-xs" aria-label={`New voice note, ${formatClock(seconds)}`} />
      <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={disabled}>
        <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Discard
      </Button>
    </div>
  );
}
