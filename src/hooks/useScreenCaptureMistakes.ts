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
  deleteScreenCaptureQuestion,
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
const KNOWN_APPS: { package_name: string; label: string }[] = [
  { package_name: "com.physicswallah.pw", label: "Physics Wallah" },
  { package_name: "com.unacademy", label: "Unacademy" },
  { package_name: "com.byjus.thelearningapp", label: "BYJU'S" },
];

/** Max watch frames waiting for upload — mirrors native pending SEND cap. */
const MAX_UPLOAD_QUEUE = 8;

/** §4 — first-time "PW at launch" only; empty after uncheck stays empty. */
function allowlistTouchedKey(userId: string): string {
  return `gurukul.capture.allowlist_touched.${userId}`;
}

function markAllowlistTouched(userId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(allowlistTouchedKey(userId), "1");
  } catch {
    /* private mode */
  }
}

function wasAllowlistTouched(userId: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(allowlistTouchedKey(userId)) === "1";
  } catch {
    return false;
  }
}

type AllowedAppsClient = {
  from: (t: string) => {
    upsert: (
      row: { owner_id: string; package_name: string; label: string },
      opts: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
    delete: () => {
      eq: (a: string, b: string) => {
        eq: (c: string, d: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
};

async function setAppAllowedInternal(
  userId: string,
  packageName: string,
  label: string,
  allowed: boolean,
) {
  const client = supabase as unknown as AllowedAppsClient;
  if (allowed) {
    const { error } = await client.from("student_capture_allowed_apps").upsert(
      { owner_id: userId, package_name: packageName, label },
      { onConflict: "owner_id,package_name" },
    );
    if (error) throw new Error(error.message);
  } else {
    const { error } = await client
      .from("student_capture_allowed_apps")
      .delete()
      .eq("owner_id", userId)
      .eq("package_name", packageName);
    if (error) throw new Error(error.message);
  }
}

export type ScreenCaptureMistakesApi = {
  available: boolean;
  watching: boolean;
  busy: boolean;
  usageAccess: boolean | null;
  allowedPackages: string[];
  knownApps: typeof KNOWN_APPS;
  counters: FunnelCountersJs | null;
  lastResult: ScreenCaptureSubmitResult | null;
  ensurePwAllowed: () => Promise<void>;
  setAppAllowed: (packageName: string, label: string, allowed: boolean) => Promise<void>;
  showTap: () => Promise<void>;
  hideTap: () => Promise<void>;
  startWatch: () => Promise<void>;
  stopWatch: () => Promise<void>;
  refreshCounters: () => Promise<void>;
  deleteCapture: (captureQuestionId: string) => Promise<boolean>;
};

async function loadAllowedPackages(userId: string): Promise<string[]> {
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
  schoolId?: string | null;
}): ScreenCaptureMistakesApi {
  const available = isNativeScreenCaptureAvailable();
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usageAccess, setUsageAccess] = useState<boolean | null>(null);
  const [allowedPackages, setAllowedPackages] = useState<string[]>([]);
  const [counters, setCounters] = useState<FunnelCountersJs | null>(null);
  const [lastResult, setLastResult] = useState<ScreenCaptureSubmitResult | null>(null);
  const uploading = useRef(false);
  const uploadQueue = useRef<{ frame: CaptureFrame; source: "tap" | "watch" }[]>([]);
  const allowedRef = useRef<string[]>([]);
  const examRef = useRef(opts.examId);
  const schoolRef = useRef(opts.schoolId);
  const watchingRef = useRef(false);
  const stopToastFromUi = useRef(false);

  const setWatchingSync = useCallback((v: boolean) => {
    watchingRef.current = v;
    setWatching(v);
  }, []);

  useEffect(() => {
    examRef.current = opts.examId;
  }, [opts.examId]);

  useEffect(() => {
    schoolRef.current = opts.schoolId;
  }, [opts.schoolId]);

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
      if (typeof c.watch_active === "boolean") setWatchingSync(c.watch_active);
    } catch {
      /* not mid-session */
    }
  }, [available, setWatchingSync]);

  const refreshUsageAccess = useCallback(async () => {
    if (!available) return;
    try {
      const u = await ScreenCaptureMistake.hasUsageAccess();
      setUsageAccess(u.allowed);
    } catch {
      setUsageAccess(null);
    }
  }, [available]);

  const processUploadQueue = useCallback(async () => {
    if (uploading.current) return;
    uploading.current = true;
    setBusy(true);
    try {
      while (uploadQueue.current.length > 0) {
        const job = uploadQueue.current.shift();
        if (!job?.frame.image_base64) continue;
        const pkg = (job.frame.package_name ?? "").trim();
        if (!pkg) continue;
        // Server loads allowlist from DB — do not invent DEFAULT_PW here.
        try {
          const result = await submitScreenCaptureMistake({
            image_base64: job.frame.image_base64,
            mime_type: job.frame.mime_type ?? "image/png",
            package_name: pkg,
            exam_id: examRef.current ?? null,
            school_id: schoolRef.current ?? null,
          });
          setLastResult(result);
          if (!result.ok) {
            toast.error(result.error ?? result.message ?? "Capture upload failed");
          } else if (result.captured === false) {
            // §6.5 / server refuse — always tell the student (tap or watch).
            toast.message(result.message ?? result.reason ?? "Not captured");
          } else if (result.captured) {
            toast.success(
              result.times_wrong && result.times_wrong > 1
                ? `Mistake noted again (×${result.times_wrong})`
                : "Mistake captured",
            );
          }
          if (job.source === "watch") await refreshCounters();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Capture upload failed");
        }
      }
    } finally {
      uploading.current = false;
      setBusy(false);
      if (uploadQueue.current.length > 0) void processUploadQueue();
    }
  }, [refreshCounters]);

  const enqueueUpload = useCallback(
    (frame: CaptureFrame, source: "tap" | "watch") => {
      if (!frame.image_base64) return;
      if (uploadQueue.current.length >= MAX_UPLOAD_QUEUE) {
        uploadQueue.current.shift();
        toast.message("Capture queue full — oldest frame dropped");
      }
      uploadQueue.current.push({ frame, source });
      void processUploadQueue();
    },
    [processUploadQueue],
  );

  // Load allowlist + register native listeners once.
  useEffect(() => {
    if (!available || !opts.userId) return;
    let cancelled = false;
    const handles: { remove: () => Promise<void> }[] = [];

    (async () => {
      const uid = opts.userId!;
      let pkgs = await loadAllowedPackages(uid);
      if (cancelled) return;
      // §4 PW at launch — once. After the student has touched the list (including
      // unchecking everything), empty stays empty and native §5.1 drops all apps.
      if (pkgs.length === 0 && !wasAllowlistTouched(uid)) {
        try {
          await setAppAllowedInternal(uid, DEFAULT_PW, "Physics Wallah", true);
          pkgs = await loadAllowedPackages(uid);
          if (pkgs.length > 0) markAllowlistTouched(uid);
        } catch (e) {
          console.warn(
            "[screen-capture] first-time PW seed failed",
            e instanceof Error ? e.message : e,
          );
        }
      } else if (pkgs.length > 0) {
        markAllowlistTouched(uid);
      }
      if (cancelled) return;
      setAllowedPackages(pkgs);
      allowedRef.current = pkgs;
      await syncNativeAllowlist(pkgs);
      await refreshUsageAccess();
      if (cancelled) return;

      const tap = await ScreenCaptureMistake.addListener("tapRequested", async () => {
        if (watchingRef.current) {
          toast.message("Stop watching first — tap capture uses the same screen session");
          return;
        }
        try {
          const frame = await ScreenCaptureMistake.captureOnce();
          enqueueUpload(frame, "tap");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error(msg.includes("watch_session") ? "Stop watching first" : msg);
        }
      });
      if (cancelled) {
        void tap.remove();
        return;
      }
      handles.push(tap);

      const watch = await ScreenCaptureMistake.addListener(
        "watchFrameReady",
        (event) => {
          if (!event?.image_base64) return;
          enqueueUpload(event, "watch");
        },
      );
      if (cancelled) {
        void watch.remove();
        return;
      }
      handles.push(watch);

      const ended = await ScreenCaptureMistake.addListener("watchSessionEnded", () => {
        setWatchingSync(false);
        void refreshCounters();
        if (!stopToastFromUi.current) {
          toast.message("Mistake watch stopped");
        }
        stopToastFromUi.current = false;
      });
      if (cancelled) {
        void ended.remove();
        return;
      }
      handles.push(ended);
    })();

    return () => {
      cancelled = true;
      for (const h of handles) void h.remove();
    };
  }, [available, opts.userId, syncNativeAllowlist, enqueueUpload, refreshCounters, refreshUsageAccess, setWatchingSync]);

  // Resume usage-access after Settings; live counters while watching.
  useEffect(() => {
    if (!available) return;
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refreshUsageAccess();
        if (watchingRef.current) void refreshCounters();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [available, refreshCounters, refreshUsageAccess]);

  useEffect(() => {
    if (!available || !watching) return;
    const id = window.setInterval(() => {
      void refreshCounters();
    }, 4000);
    return () => window.clearInterval(id);
  }, [available, watching, refreshCounters]);

  /** Reload DB allowlist into state + native. Never invent packages. */
  const ensurePwAllowed = useCallback(async () => {
    if (!opts.userId) return;
    const pkgs = await loadAllowedPackages(opts.userId);
    if (pkgs.length > 0) markAllowlistTouched(opts.userId);
    setAllowedPackages(pkgs);
    allowedRef.current = pkgs;
    await syncNativeAllowlist(pkgs);
  }, [opts.userId, syncNativeAllowlist]);

  const setAppAllowed = useCallback(
    async (packageName: string, label: string, allowed: boolean) => {
      if (!opts.userId) {
        toast.error("Sign in to change allowed apps");
        return;
      }
      try {
        markAllowlistTouched(opts.userId);
        await setAppAllowedInternal(opts.userId, packageName, label, allowed);
        const pkgs = await loadAllowedPackages(opts.userId);
        setAllowedPackages(pkgs);
        allowedRef.current = pkgs;
        await syncNativeAllowlist(pkgs);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update app list");
      }
    },
    [opts.userId, syncNativeAllowlist],
  );

  const showTap = useCallback(async () => {
    if (!available) return;
    if (watchingRef.current) {
      toast.message("Stop watching first to use the tap button");
      return;
    }
    setBusy(true);
    try {
      await ensurePwAllowed();
      if (allowedRef.current.length === 0) {
        toast.message("Choose at least one allowed app first");
        return;
      }
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
      if (allowedRef.current.length === 0) {
        toast.message("Choose at least one allowed app first");
        return;
      }
      await refreshUsageAccess();
      const usage = await ScreenCaptureMistake.hasUsageAccess();
      if (!usage.allowed) {
        toast.message("Turn on usage access for Gurukul, then return here");
        await ScreenCaptureMistake.openUsageAccessSettings();
        return;
      }
      // §13 Android 15 — keep Stage 1 overlay visible for mediaProjection FGS.
      let overlay = await ScreenCaptureMistake.canDrawOverlays();
      if (!overlay.allowed) {
        overlay = await ScreenCaptureMistake.requestOverlayPermission();
      }
      if (!overlay.allowed) {
        toast.error("Overlay permission required to watch");
        return;
      }
      await ScreenCaptureMistake.showTapOverlay();
      // Block tap immediately — overlay is up before MediaProjection consent returns.
      setWatchingSync(true);
      try {
        await ScreenCaptureMistake.startWatchSession();
      } catch (e) {
        setWatchingSync(false);
        throw e;
      }
      toast.message("Watching for mistakes — only allowlisted apps, on-device filter");
      await refreshCounters();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("usage_access")) toast.error("Usage access required");
      else if (msg.includes("overlay")) toast.error("Overlay permission required");
      else toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [available, ensurePwAllowed, refreshCounters, refreshUsageAccess, setWatchingSync]);

  const stopWatch = useCallback(async () => {
    if (!available) return;
    setBusy(true);
    try {
      stopToastFromUi.current = true;
      await ScreenCaptureMistake.stopWatchSession();
      setWatchingSync(false);
      await refreshCounters();
      toast.message("Mistake watch stopped");
    } catch (e) {
      stopToastFromUi.current = false;
      toast.error(e instanceof Error ? e.message : "Could not stop watch");
    } finally {
      setBusy(false);
    }
  }, [available, refreshCounters, setWatchingSync]);

  const deleteCapture = useCallback(async (captureQuestionId: string) => {
    const ok = await deleteScreenCaptureQuestion(captureQuestionId);
    if (ok) {
      setLastResult((prev) =>
        prev?.capture_question_id === captureQuestionId ? null : prev,
      );
      toast.success("Captured question deleted");
    } else {
      toast.error("Could not delete capture");
    }
    return ok;
  }, []);

  return {
    available,
    watching,
    busy,
    usageAccess,
    allowedPackages,
    knownApps: KNOWN_APPS,
    counters,
    lastResult,
    ensurePwAllowed,
    setAppAllowed,
    showTap,
    hideTap,
    startWatch,
    stopWatch,
    refreshCounters,
    deleteCapture,
  };
}
