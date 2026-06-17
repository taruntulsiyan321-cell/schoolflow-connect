/** Detect placeholder / broken MCQ options from the template engine. */
export function mcqOptionsInvalid(options: string[] | undefined | null): boolean {
  if (!options || options.length < 2) return true;
  if (options.length < 4) return true;
  if (options[0] === "Option A") return true;

  const trimmed = options.map((o) => o.trim()).filter(Boolean);
  if (trimmed.length < 4) return true;
  if (new Set(trimmed).size !== trimmed.length) return true;

  if (trimmed.some((o) => /\(alt\s*\d+\)/i.test(o))) return true;

  const stripped = trimmed.map((o) => o.replace(/\s*\(alt\s*\d+\)\s*$/i, "").replace(/\?+$/, "").trim());
  if (new Set(stripped).size < Math.min(3, trimmed.length)) return true;

  return false;
}

export function normalizeMcqOptions(
  options: string[],
  correctIndex: number,
): { options: string[]; correctIndex: number } | null {
  const seen = new Set<string>();
  const unique: string[] = [];
  const indexMap: number[] = [];

  options.forEach((opt, i) => {
    const t = opt.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    indexMap.push(i);
    unique.push(t);
  });

  if (unique.length < 4) return null;

  const correctText = options[correctIndex]?.trim();
  let newCorrect = unique.indexOf(correctText ?? "");
  if (newCorrect < 0) newCorrect = 0;

  return { options: unique.slice(0, 4), correctIndex: newCorrect };
}
