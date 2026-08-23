/** Applies alpha to a `hsl(var(--token))` color string, e.g. withAlpha("hsl(var(--primary))", 0.15). */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("hsl(") && color.endsWith(")")) {
    return `${color.slice(0, -1)} / ${alpha})`;
  }
  return color;
}
