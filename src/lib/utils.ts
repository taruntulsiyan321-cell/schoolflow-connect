import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ClassLike = {
  kind?: string | null;
  name?: string | null;
  section?: string | null;
  display_name?: string | null;
} | null | undefined;

/** Human label for a class OR batch row. Batches use display_name; classes use "Class name-section". */
export function classLabel(c: ClassLike, fallback = "Unassigned"): string {
  if (!c) return fallback;
  if (c.kind === "batch") return c.display_name || "Batch";
  const base = [c.name, c.section].filter(Boolean).join("-");
  if (base) return `Class ${base}`;
  return c.display_name || c.name || fallback;
}
