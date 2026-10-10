import { useCallback, useEffect, useSyncExternalStore } from "react";
import { readPhotoPath, removeProfilePhoto, saveProfilePhoto, signPhoto } from "@/lib/profilePhoto";

/**
 * The signed-in student's photo, as every place that shows it reads it (D1):
 * the top bar, the account menu, the bottom bar's Account tab and the Profile
 * card. One store, so a photo saved on Profile is the photo everywhere at
 * once, and it is read once per account rather than once per place.
 */
type PhotoState = { userId: string | null; path: string | null; url: string | null; status: "idle" | "loading" | "ready" | "failed" };

const IDLE: PhotoState = { userId: null, path: null, url: null, status: "idle" };
let state: PhotoState = IDLE;
const listeners = new Set<() => void>();

function set(next: PhotoState) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

async function load(userId: string) {
  if (state.userId === userId && state.status !== "idle") return;
  set({ userId, path: null, url: null, status: "loading" });
  try {
    const path = await readPhotoPath(userId);
    const url = path ? await signPhoto(path) : null;
    if (state.userId === userId) set({ userId, path, url, status: "ready" });
  } catch (e) {
    // The initials show; the reason is in the console, not swallowed.
    console.warn("[profile photo] could not load", e);
    if (state.userId === userId) set({ userId, path: null, url: null, status: "failed" });
  }
}

/** For tests, and for the next account to start clean. */
export function resetProfilePhotoStore() {
  set(IDLE);
}

export function useProfilePhoto(userId: string | null | undefined) {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (userId) void load(userId);
  }, [userId]);
  const mine = userId && snap.userId === userId ? snap : null;

  const save = useCallback(
    async (photo: Blob) => {
      if (!userId) throw new Error("Sign in to add a photo.");
      const path = await saveProfilePhoto(userId, photo, state.userId === userId ? state.path : null);
      const url = await signPhoto(path);
      set({ userId, path, url, status: "ready" });
    },
    [userId],
  );

  const remove = useCallback(async () => {
    if (!userId) return;
    await removeProfilePhoto(state.userId === userId ? state.path : null);
    set({ userId, path: null, url: null, status: "ready" });
  }, [userId]);

  return { url: mine?.url ?? null, hasPhoto: Boolean(mine?.path), save, remove };
}
