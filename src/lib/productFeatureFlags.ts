/**
 * Product feature flags for planned capabilities.
 * Unavailable features are never labeled "Not available" — use Coming Soon or hide.
 *
 * Per-capability booleans (live when true). Global mode for false flags:
 *   UNAVAILABLE_FEATURE_MODE = "coming_soon" | "hide"
 * Override via Vite env, e.g. VITE_FF_NOVA_ATTACHMENT=0, VITE_FF_UNAVAILABLE_MODE=hide
 *
 * Each flag names its own variable (import.meta.env.VITE_FF_…), which Vite
 * replaces with that one value. Never read import.meta.env as an object or by
 * a computed key: Vite then inlines ALL of it, and on Vercel that is every
 * VITE_VERCEL_* system variable — the commit message, its author, the
 * repository. envAccess.test.ts fails on it.
 */

type FeaturePresentation = "live" | "coming_soon" | "hidden";
type UnavailableFeatureMode = "coming_soon" | "hide";

export const COMING_SOON_LABEL = "Coming Soon";

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "on", "enabled", "live"].includes(v)) return true;
  if (["0", "false", "off", "disabled", "hidden"].includes(v)) return false;
  return fallback;
}

function parseUnavailableMode(raw: unknown): UnavailableFeatureMode {
  if (typeof raw !== "string") return "coming_soon";
  const v = raw.trim().toLowerCase().replace(/-/g, "_");
  if (v === "hide" || v === "hidden") return "hide";
  return "coming_soon";
}

/** How disabled product features present in UI. */
export const UNAVAILABLE_FEATURE_MODE: UnavailableFeatureMode = parseUnavailableMode(
  import.meta.env.VITE_FF_UNAVAILABLE_MODE,
);

/** Nova input capabilities. Voice is not a flag: it is offered wherever the
 *  browser has speech recognition (useSpeechCapture), since 2026-10-02. */
export const NOVA_FEATURE_FLAGS = {
  // Live: photo (camera/gallery) + PDF attachment, routed to a vision-capable model.
  // Override with VITE_FF_NOVA_ATTACHMENT=0 to disable without a code change.
  attachment: parseBool(import.meta.env.VITE_FF_NOVA_ATTACHMENT, true),
} as const;

/** Decision Engine integration switches — default OFF until a slice is
 * proven in normal use (see docs/GURUKUL_ACADEMIC_DECISION_ENGINE_SPEC.md). */
export const DECISION_ENGINE_FEATURE_FLAGS = {
  weakAreasV2: parseBool(import.meta.env.VITE_FF_DECISION_ENGINE_WEAK_AREAS_V2, false),
  revisionV2: parseBool(import.meta.env.VITE_FF_DECISION_ENGINE_REVISION_V2, false),
} as const;
if (DECISION_ENGINE_FEATURE_FLAGS.weakAreasV2) {
  // Once per app load, never per-request -- confirms this build actually
  // has the flag baked in (VITE_FF_* is resolved at build time), so
  // "I turned the flag on" is verifiable from the browser console alone.
  console.log("[DecisionEngine] Weak Areas V2 enabled");
}
if (DECISION_ENGINE_FEATURE_FLAGS.revisionV2) {
  console.log("[DecisionEngine] Revision V2 enabled");
}

export function resolveFeaturePresentation(enabled: boolean): FeaturePresentation {
  if (enabled) return "live";
  return UNAVAILABLE_FEATURE_MODE === "hide" ? "hidden" : "coming_soon";
}

export function resolveNovaPresentation(kind: keyof typeof NOVA_FEATURE_FLAGS): FeaturePresentation {
  return resolveFeaturePresentation(NOVA_FEATURE_FLAGS[kind]);
}

export function comingSoonToast(capability: string): string {
  return `${capability} — ${COMING_SOON_LABEL}`;
}
