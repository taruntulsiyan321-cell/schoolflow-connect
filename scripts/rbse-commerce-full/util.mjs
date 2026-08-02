/** @typedef {{ q:string, o:[string,string,string,string], c:number, e:string, ch:string, concept:string, diff?:string }} Q */

/** @returns {Q} */
export function Q(ch, concept, q, o, c, e, diff = "medium") {
  return { ch, concept, q, o, c, e, diff };
}

/** Ensure ~target questions; if short, duplicate is forbidden — caller must supply enough. */
export function assertChapterCoverage(items, subject, classLevel, chapters, minPerChapter = 8) {
  const byCh = new Map();
  for (const it of items) {
    byCh.set(it.ch, (byCh.get(it.ch) || 0) + 1);
  }
  const missing = [];
  const thin = [];
  for (const ch of chapters) {
    const n = byCh.get(ch) || 0;
    if (n === 0) missing.push(ch);
    else if (n < minPerChapter) thin.push(`${ch}(${n})`);
  }
  if (missing.length || thin.length) {
    console.error(`Coverage issues ${subject} ${classLevel}:`);
    if (missing.length) console.error("  MISSING:", missing.join(" | "));
    if (thin.length) console.error("  THIN:", thin.join(" | "));
  }
  return { missing, thin, byCh };
}
