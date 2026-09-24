/**
 * Stage 1 tap + Stage 2 watch → submitScreenCaptureMistake.
 * Binding: docs/screen-capture-mistakes-spec.md §5 / §7 / §10.2
 *
 * Mount once in the student shell. Native emits frames; this hook is the only
 * path that may touch the network after the on-device funnel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  submitScreenCaptureMistake,
  type ScreenCaptureSubmitResult,
} from "@/academic/services/screenCaptureService";
import {
  isNativeScreenCaptureAvailable,
  ScreenCaptureMistake,
  type CaptureFrame,
  type FunnelCountersJs,
} from "@/lib/screenCaptureMistake";

const DEFAULT_PW = "com.physicswallah.pw";

export type ScreenCaptureMistakesApi = {
  available: boolean;
  watching: boolean;
  busy: boolean;
  allowedPackages: string[];
  counters: FunnelCountersJs | null;
  lastResult: ScreenCaptureSubmitResult | null;
  ensurePwAllowed: () => Promise<void>;
  showTap: () => Promise<void>;
  hideTap: () => Promise<void>;
  startWatch: () => Promise<void>;
  stopWatch: () => Promise<void>;
  refreshCounters: () => Promise<void>;
};

async function loadAllowedPackages(userId: string): Promise<string[]> {
  // Table is live (20261077); generated Database types lag until regen.
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ data: { package_name: string }[] | null; error: { message: string } | null }>;
      };
    };
  })
    .from("student_capture_allowed_apps")
    .select("package_name")
    .eq("owner_id", userId);
  if (error) {
    console.warn("[screen-capture] allowed apps read failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => String(r.package_name)).filter(Boolean);
}

export function useScreenCaptureMistakes(opts: {
  userId: string | undefined;
  examId: string | null | undefined;
}): ScreenCaptureMistakesApi {
  const available = isNativeScreenCaptureAvailable();
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [allowedPackages, setAllowedPackages] = useState<string[]>([]);
  const [counters, setCounters] = useState<FunnelCountersJs | null>(null);
  const [lastResult, setLastResult] = useState<ScreenCaptureSubmitResult | null>(null);
  const submitting = useRef(false);
  const allowedRef = useRef<string[]>([]);
  const examRef = useRef(opts.examId);

  useEffect(() => {
    examRef.current = opts.examId;
  }, [opts.examId]);

  useEffect(() => {
    allowedRef.current = allowedPackages;
  }, [allowedPackages]);

  const syncNativeAllowlist = useCallback(async (packages: string[]) => {
    if (!available) return;
    await ScreenCaptureMistake.setAllowedPackages({ packages });
  }, [available]);

  const refreshCounters = useCallback(async () => {
    if (!available) return;
    try {
      const c = await ScreenCaptureMistake.getFunnelCounters();
      setCounters(c);
    } catch {
      /* not mid-session */
    }
  }, [available]);

  const uploadFrame = useCallback(async (frame: CaptureFrame, source: "tap" | "watch") => {
    if (submitting.current) return;
    const pkg = (frame.package_name ?? "").trim() || DEFAULT_PW;
    const allow = allowedRef.current.length > 0 ? allowedRef.current : [DEFAULT_PW];
    if (!frame.image_base64) return;
    submitting.current = true;
    setBusy(true);
    try {
      const result = await submitScreenCaptureMistake({
        image_base64: frame.image_base64,
        mime_type: frame.mime_type ?? "image/png",
        package_name: pkg,
        allowed_packages: allow,
        exam_id: examRef.current ?? null,
      });
      setLastResult(result);
      if (!result.ok) {
        toast.error(result.error ?? result.message ?? "Capture upload failed");
      } else if (result.captured === false) {
        // Funnel/server refused — quiet for watch (high volume); tap gets a reason.
        if (source === "tap") {
          toast.message(result.message ?? result.reason ?? "Not captured");
        }
      } else if (result.captured) {
        toast.success(
          result.times_wrong && result.times_wrong > 1
            ? `Mistake noted again (×${result.times_wrong})`
            : "Mistake captured",
        );
      }
      if (source === "watch") await refreshCounters();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }, [refreshCounters]);

  // Load allowlist + register native listeners once.
  useEffect(() => {
    if (!available || !opts.userId) return;
    let cancelled = false;
    const handles: { remove: () => Promise<void> }[] = [];

    (async () => {
      const pkgs = await loadAllowedPackages(opts.userId!);
      if (cancelled) return;
      setAllowedPackages(pkgs);
      await syncNativeAllowlist(pkgs.length > 0 ? pkgs : [DEFAULT_PW]);

      const tap = await ScreenCaptureMistake.addListener("tapRequested", async () => {
        try {
          const frame = await ScreenCaptureMistake.captureOnce();
          await uploadFrame(frame, "tap");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Capture failed");
        }
      });
      handles.push(tap);

      const watch = await ScreenCaptureMistake.addListener(
        "watchFrameReady",
        async (event) => {
          if (!event?.image_base64) return;
          await uploadFrame(event, "watch");
        },
      );
      handles.push(watch);
    })();

    return () => {
      cancelled = true;
      for (const h of handles) void h.remove();
    };
  }, [available, opts.userId, syncNativeAllowlist, uploadFrame]);

  const ensurePwAllowed = useCallback(async () => {
    if (!opts.userId) return;
    const { error } = await (supabase as unknown as {
      from: (t: string) => {
        upsert: (
          row: { owner_id: string; package_name: string; label: string },
          opts: { onConflict: string },
        ) => Promise<{ error: { message: string } | null }>;
      };
    })
      .from("student_capture_allowed_apps")
      .upsert(
        {
          owner_id: opts.userId,
          package_name: DEFAULT_PW,
          label: "Physics Wallah",
        },
        { onConflict: "owner_id,package_name" },
      );
    if (error) {
      toast.error(error.message);
      return;
    }
    const pkgs = await loadAllowedPackages(opts.userId);
    setAllowedPackages(pkgs);
    await syncNativeAllowlist(pkgs);
  }, [opts.userId, syncNativeAllowlist]);

  const showTap = useCallback(async () => {
    if (!available) return;
    setBusy(true);
    try {
      await ensurePwAllowed();
      const overlay = await ScreenCaptureMistake.canDrawOverlays();
      if (!overlay.allowed) {
        await ScreenCaptureMistake.requestOverlayPermission();
      }
      await ScreenCaptureMistake.showTapOverlay();
      toast.message("Tap the Gurukul button when you get one wrong");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not show tap control");
    } finally {
      setBusy(false);
    }
  }, [available, ensurePwAllowed]);

  const hideTap = useCallback(async () => {
    if (!available) return;
    await ScreenCaptureMistake.hideTapOverlay();
  }, [available]);

  const startWatch = useCallback(async () => {
    if (!available) return;
    setBusy(true);
    try {
      await ensurePwAllowed();
      const usage = await ScreenCaptureMistake.hasUsageAccess();
      if (!usage.allowed) {
        toast.message("Turn on usage access for Gurukul, then try again");
        await ScreenCaptureMistake.openUsageAccessSettings();
        return;
      }
      await ScreenCaptureMistake.startWatchSession();
      setWatching(true);
      toast.message("Watching for mistakes — only allowlisted apps, on-device filter");
      await refreshCounters();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.includes("usage_access") ? "Usage access required" : msg);
    } finally {
      setBusy(false);
    }
  }, [available, ensurePwAllowed, refreshCounters]);

  const stopWatch = useCallback(async () => {
    if (!available) return;
    setBusy(true);
    try {
      await ScreenCaptureMistake.stopWatchSession();
      setWatching(false);
      await refreshCounters();
      toast.message("Mistake watch stopped");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not stop watch");
    } finally {
      setBusy(false);
    }
  }, [available, refreshCounters]);

  return {
    available,
    watching,
    busy,
    allowedPackages,
    counters,
    lastResult,
    ensurePwAllowed,
    showTap,
    hideTap,
    startWatch,
    stopWatch,
    refreshCounters,
  };
}
