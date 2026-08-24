/**
 * Single owner of every localStorage key this app writes.
 *
 * Why this file exists: writers and `clearClientAuthCaches()` were written
 * against two different key conventions ("gurukul." vs "gurukul:"), so the
 * clear function matched nothing and had never removed a key. Nova
 * conversations — which contain a student's weak concepts and wrong answers —
 * were stored under one global key, survived sign-out, and were loaded by
 * whoever signed in next on a shared device. Building keys here is what stops
 * the two sides drifting apart again.
 */

const NS = "gurukul:";

/**
 * Keys written before this namespace existed. Purged on sign-out so data that
 * already leaked onto a device is actually removed, not just orphaned.
 */
const LEGACY_EXACT_KEYS = [
  "gurukul.nova.convos.v1",
  "recovery-success-history",
  "app-settings",
];
const LEGACY_PREFIXES = ["gurukul.mistake.bookmarks."];

export type StorageIdentity = { userId: string; schoolId: string };

/** Null unless both halves of the identity are known — never fall back to a shared key. */
export function scopedKey(name: string, identity: Partial<StorageIdentity>): string | null {
  if (!identity.userId || !identity.schoolId) return null;
  return `${NS}${name}:${identity.schoolId}:${identity.userId}`;
}

export function novaConversationsKey(identity: Partial<StorageIdentity>): string | null {
  return scopedKey("nova.convos.v1", identity);
}

export function mistakeBookmarksKey(identity: Partial<StorageIdentity>): string | null {
  return scopedKey("mistake.bookmarks.v1", identity);
}

export function recoverySuccessHistoryKey(identity: Partial<StorageIdentity>): string | null {
  return scopedKey("recovery.success.v1", identity);
}

/** School-scoped, not user-scoped: this caches school configuration, not personal data. */
export function appSettingsKey(schoolId?: string | null): string | null {
  return schoolId ? `${NS}app-settings.v1:${schoolId}` : null;
}

export function clearAppStorage(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      const isNamespaced = key.startsWith(NS);
      const isLegacy =
        LEGACY_EXACT_KEYS.includes(key) || LEGACY_PREFIXES.some((p) => key.startsWith(p));
      if (isNamespaced || isLegacy) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable (private mode, quota) — nothing to clear */
  }
}
