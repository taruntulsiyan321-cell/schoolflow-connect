import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_ZOOM, clampOffset, cropRect, loadImage, renderSquare, type Offset } from "@/lib/cropSquare";
import { toErrorMessage } from "@/lib/presentation";

/** The crop window's side on screen, in CSS pixels. */
const VIEW = 256;

/**
 * Adding, replacing and removing the student's photo (docs/TODO.md D1). The
 * phone's camera and its gallery are two buttons: "Take a photo" asks the
 * browser or the Android app for the camera (`capture`), "Choose a photo"
 * for the gallery or files. A desktop has no camera to offer, so it shows
 * only the second. Whatever is picked is cropped to a square here before
 * anything is uploaded.
 */
export function ProfilePhotoEditor({
  hasPhoto, onSave, onRemove,
}: {
  hasPhoto: boolean;
  onSave: (photo: Blob) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const offerCamera = Capacitor.isNativePlatform() || window.matchMedia?.("(pointer: coarse)").matches === true;

  const picked = (input: HTMLInputElement | null) => {
    const f = input?.files?.[0] ?? null;
    if (input) input.value = ""; // the same file can be picked again
    if (f) setFile(f);
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await onRemove();
      toast.success("Photo removed — your initials show again.");
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not remove your photo"));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap gap-2" data-testid="photo-editor">
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden" data-testid="photo-camera-input"
        onChange={(e) => picked(e.currentTarget)} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" data-testid="photo-gallery-input"
        onChange={(e) => picked(e.currentTarget)} />
      {offerCamera && (
        <Button type="button" variant="outline" size="sm" onClick={() => cameraRef.current?.click()}>
          <Camera className="h-3.5 w-3.5" aria-hidden /> Take a photo
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => galleryRef.current?.click()}>
        <ImagePlus className="h-3.5 w-3.5" aria-hidden /> {hasPhoto ? "Change photo" : "Add a photo"}
      </Button>
      {hasPhoto && (
        <Button type="button" variant="ghost" size="sm" disabled={removing} onClick={() => void remove()}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden /> {removing ? "Removing…" : "Remove photo"}
        </Button>
      )}
      {file && (
        <CropDialog
          file={file}
          onClose={() => setFile(null)}
          onSave={async (blob) => {
            await onSave(blob);
            setFile(null);
            toast.success("Photo saved.");
          }}
        />
      )}
    </div>
  );
}

/** A square window over the photo: drag to move it, the slider to zoom. */
function CropDialog({ file, onClose, onSave }: { file: File; onClose: () => void; onSave: (blob: Blob) => Promise<void> }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ x: number; y: number; from: Offset } | null>(null);

  useEffect(() => {
    let alive = true;
    loadImage(file).then(
      (i) => { if (alive) setImg(i); },
      (e) => { if (alive) setError(toErrorMessage(e, "This photo can't be opened here.")); },
    );
    return () => { alive = false; };
  }, [file]);

  const size = img ? { width: img.naturalWidth, height: img.naturalHeight } : null;
  const rect = size ? cropRect(size, zoom, offset) : null;
  const scale = rect ? VIEW / rect.size : 1;

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: offset };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !size) return;
    const { x, y, from } = drag.current;
    // Moving the picture right shows more of its left: the window moves the other way.
    setOffset(clampOffset(size, zoom, { x: from.x - (e.clientX - x) / scale, y: from.y - (e.clientY - y) / scale }));
  };
  const onUp = () => { drag.current = null; };

  const save = async () => {
    if (!img || !rect) return;
    setSaving(true);
    try {
      await onSave(await renderSquare(img, rect));
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not save your photo"));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your photo</DialogTitle>
          <DialogDescription>Drag to move it and zoom to fit. Only you can see it.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        ) : !img || !rect || !size ? (
          <p className="text-sm text-muted-foreground" role="status">Opening the photo…</p>
        ) : (
          <div className="space-y-3">
            <div
              className="relative mx-auto touch-none select-none overflow-hidden rounded-full border border-border bg-muted"
              style={{ width: VIEW, height: VIEW, cursor: "grab" }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              data-testid="crop-window"
            >
              <img
                src={img.src}
                alt=""
                draggable={false}
                className="absolute max-w-none"
                style={{ width: size.width * scale, height: size.height * scale, left: -rect.sx * scale, top: -rect.sy * scale }}
              />
            </div>
            <label className="flex items-center gap-3 text-xs text-muted-foreground">
              Zoom
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => {
                  const z = Number(e.currentTarget.value);
                  setZoom(z);
                  setOffset(clampOffset(size, z, offset));
                }}
                className="flex-1"
                aria-label="Zoom"
              />
            </label>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={!img || saving || Boolean(error)}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…</> : "Use this photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
