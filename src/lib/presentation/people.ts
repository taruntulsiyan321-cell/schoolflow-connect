/**
 * Person / entity name presentation.
 *
 * WHY THIS EXISTS
 * ---------------
 * Five panels independently used the same anti-pattern when a name lookup
 * missed:
 *
 *     fullName: names.get(p.studentId)?.fullName ?? p.studentId.slice(0, 8)
 *     name: r.name || r.user_id.slice(0, 8)
 *
 * The user then saw `3f2a9c11` where a classmate's name belonged — on the
 * student Leaderboard, in principal rankings, in a teacher's submission list,
 * in a parent's exam list, and inside an exported admin report.
 *
 * A missing name is an empty state, not an id. This module makes the safe
 * choice the easy one.
 */

import { toDisplayText, isIdentifierLike } from "./safeText";

/** What kind of person the name belongs to — drives the fallback wording. */
export type PersonKind = "student" | "teacher" | "parent" | "staff" | "person";

const FALLBACK_BY_KIND: Record<PersonKind, string> = {
  student: "Unnamed student",
  teacher: "Unnamed teacher",
  parent: "Unnamed parent",
  staff: "Unnamed staff member",
  person: "Unnamed",
};

export interface PersonNameOptions {
  /** Drives the default fallback wording. */
  kind?: PersonKind;
  /** Overrides the fallback entirely. */
  fallback?: string;
  /** Cap for long names in tight layouts. */
  maxLength?: number;
}

/**
 * The user-facing name for a person.
 *
 * Returns an intentional fallback when the value is missing, corrupted, or an
 * identifier. It will never return a UUID or a UUID fragment.
 *
 * ```tsx
 * <span>{toPersonName(row.fullName, { kind: "student" })}</span>
 * ```
 */
export function toPersonName(value: unknown, options: PersonNameOptions = {}): string {
  const { kind = "person", maxLength } = options;
  const fallback = options.fallback ?? FALLBACK_BY_KIND[kind];

  // An identifier is never a name, whatever else the boundary would allow.
  if (isIdentifierLike(value)) return fallback;

  return toDisplayText(value, { kind: "name", fallback, maxLength });
}

/**
 * Pick the first usable name from several candidates, then present it.
 * Use instead of `a ?? b ?? id.slice(0, 8)`.
 *
 * ```ts
 * toPersonNameFrom([profile.fullName, row.name], { kind: "student" })
 * ```
 */
export function toPersonNameFrom(
  candidates: readonly unknown[],
  options: PersonNameOptions = {},
): string {
  for (const candidate of candidates) {
    if (isIdentifierLike(candidate)) continue;
    const presented = toDisplayText(candidate, {
      kind: "name",
      fallback: "",
      allowEmpty: true,
      maxLength: options.maxLength,
    });
    if (presented) return presented;
  }
  const { kind = "person" } = options;
  return options.fallback ?? FALLBACK_BY_KIND[kind];
}

/**
 * Initials for avatars. Returns an empty string rather than initials derived
 * from an id, so callers can fall back to an icon.
 */
export function toInitials(value: unknown, maxLetters = 2): string {
  if (isIdentifierLike(value)) return "";
  const name = toDisplayText(value, { kind: "name", fallback: "", allowEmpty: true });
  if (!name) return "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxLetters)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/**
 * A class label such as `10-A`. Falls back to an intentional string rather
 * than a class UUID.
 */
export function toClassLabel(
  name: unknown,
  section?: unknown,
  fallback = "Unassigned",
): string {
  const namePart = toDisplayText(name, {
    kind: "label",
    fallback: "",
    allowEmpty: true,
  });
  if (!namePart) return fallback;
  const sectionPart = toDisplayText(section, {
    kind: "label",
    fallback: "",
    allowEmpty: true,
  });
  return sectionPart ? `${namePart}-${sectionPart}` : namePart;
}
