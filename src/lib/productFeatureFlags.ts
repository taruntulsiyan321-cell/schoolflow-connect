/**
 * Product feature flags for planned capabilities.
 * Unavailable features are never labeled "Not available" — use Coming Soon or hide.
 *
 * Per-capability booleans (live when true). Global mode for false flags:
 *   UNAVAILABLE_FEATURE_MODE = "coming_soon" | "hide"
 * Override via Vite env, e.g. VITE_FF_DOUBT_ATTACHMENT_IMAGE=1, VITE_FF_UNAVAILABLE_MODE=hide
 */

export type FeaturePresentation = "live" | "coming_soon" | "hidden";
export type UnavailableFeatureMode = "coming_soon" | "hide";

export type DoubtAttachKind = "image" | "camera" | "pdf" | "voice";

export const COMING_SOON_LABEL = "Coming Soon";

function readEnv(key: string): string | undefined {
  try {
    const env = import.meta.env as Record<string, string | undefined>;
    return env[key];
  } catch {
    return undefined;
  }
}

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
  readEnv("VITE_FF_UNAVAILABLE_MODE"),
);

/** Live (true) vs deferred (false) doubt attachment capabilities. */
export const DOUBT_ATTACH_FLAGS: Record<DoubtAttachKind, boolean> = {
  image: parseBool(readEnv("VITE_FF_DOUBT_ATTACHMENT_IMAGE"), false),
  camera: parseBool(readEnv("VITE_FF_DOUBT_ATTACHMENT_CAMERA"), false),
  pdf: parseBool(readEnv("VITE_FF_DOUBT_ATTACHMENT_PDF"), false),
  voice: parseBool(readEnv("VITE_FF_DOUBT_ATTACHMENT_VOICE"), false),
};

/** Nova input capabilities. */
export const NOVA_FEATURE_FLAGS = {
  attachment: parseBool(readEnv("VITE_FF_NOVA_ATTACHMENT"), false),
  voice: parseBool(readEnv("VITE_FF_NOVA_VOICE"), false),
} as const;

const DOUBT_ATTACH_META: Record<DoubtAttachKind, { label: string }> = {
  image: { label: "Image" },
  camera: { label: "Camera" },
  pdf: { label: "PDF" },
  voice: { label: "Voice" },
};

export function resolveFeaturePresentation(enabled: boolean): FeaturePresentation {
  if (enabled) return "live";
  return UNAVAILABLE_FEATURE_MODE === "hide" ? "hidden" : "coming_soon";
}

export function resolveDoubtAttachPresentation(kind: DoubtAttachKind): FeaturePresentation {
  return resolveFeaturePresentation(DOUBT_ATTACH_FLAGS[kind]);
}

export function resolveNovaPresentation(kind: keyof typeof NOVA_FEATURE_FLAGS): FeaturePresentation {
  return resolveFeaturePresentation(NOVA_FEATURE_FLAGS[kind]);
}

export type DoubtAttachControl = {
  id: DoubtAttachKind;
  label: string;
  presentation: Exclude<FeaturePresentation, "hidden">;
};

/** Visible doubt attach controls (hides when mode=hide and flag=false). */
export function listDoubtAttachControls(
  kinds: DoubtAttachKind[] = ["image", "camera", "pdf", "voice"],
): DoubtAttachControl[] {
  const out: DoubtAttachControl[] = [];
  for (const id of kinds) {
    const presentation = resolveDoubtAttachPresentation(id);
    if (presentation === "hidden") continue;
    out.push({ id, label: DOUBT_ATTACH_META[id].label, presentation });
  }
  return out;
}

export function comingSoonToast(capability: string): string {
  return `${capability} — ${COMING_SOON_LABEL}`;
}
