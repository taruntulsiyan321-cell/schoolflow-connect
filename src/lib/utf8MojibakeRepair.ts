/**
 * Reverse UTF-8-as-Windows-1252 (CP1252) mojibake.
 *
 * Root cause (proven Inv5+Inv6): valid UTF-8 (Devanagari / punctuation / Greek / math)
 * was interpreted as CP1252 at import and stored as those Unicode codepoints.
 * Example: bytes of `आलो` → display `à¤†à¤²à¥‹`. Clean DB π is fine; some demo stems still have Â°/âˆš.
 *
 * Safe: only runs when classic mojibake signatures are present.
 * Never re-decodes clean Devanagari / clean π.
 *
 * SSOT for structural repair — `utf8Text.fixUtf8Content` and taxonomy
 * `fixMojibake` both call `repairUtf8Mojibake` from here.
 */

/** CP1252 byte (0x80–0x9F) → Unicode (differs from Latin-1). */
const CP1252_BYTE_TO_CP: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
  0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

const CP1252_CP_TO_BYTE = new Map<number, number>(
  Object.entries(CP1252_BYTE_TO_CP).map(([b, cp]) => [cp, Number(b)]),
);

/**
 * Classic UTF-8-as-CP1252 markers only.
 * Note: π → Ï€ (0xCF 0x80 → Ï + €); √ → âˆš (includes U+02C6 ˆ).
 * Do NOT match lone curly dashes/quotes (legitimate Unicode titles).
 */
export const UTF8_MOJIBAKE_SIGNATURE =
  /à¤|à¥|â€.|âˆ.|â‰.|Ã[\u0080-\u00ff]|Î[\u0080-\u00ff]|Ï\u20ac|Ï[\u0080-\u00ff\u20ac]|Â[°·¹²³½¼¾]/;

export function looksLikeUtf8Mojibake(text: string | null | undefined): boolean {
  if (text == null || text === "") return false;
  return UTF8_MOJIBAKE_SIGNATURE.test(String(text));
}

function mojibakeToCp1252Bytes(moj: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const ch of moj) {
    const cp = ch.codePointAt(0)!;
    const mapped = CP1252_CP_TO_BYTE.get(cp);
    if (mapped != null) {
      bytes.push(mapped);
      continue;
    }
    if (cp <= 0xff) {
      bytes.push(cp);
      continue;
    }
    return null;
  }
  return Uint8Array.from(bytes);
}

function decodeUtf8Bytes(bytes: Uint8Array): string | null {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!decoded || decoded.includes("\uFFFD")) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * If `text` looks like UTF-8-as-CP1252 mojibake, return the recovered UTF-8 string.
 * Otherwise return the input unchanged (including clean Hindi / π).
 * Up to 3 passes for accidental double-encoding.
 */
export function repairUtf8Mojibake(text: string | null | undefined): string {
  if (text == null) return "";
  let s = String(text);
  if (!s) return "";

  for (let pass = 0; pass < 3; pass++) {
    if (!looksLikeUtf8Mojibake(s)) break;
    const bytes = mojibakeToCp1252Bytes(s);
    if (!bytes) break;
    const repaired = decodeUtf8Bytes(bytes);
    if (repaired == null || repaired === s) break;
    s = repaired;
  }
  return s;
}
