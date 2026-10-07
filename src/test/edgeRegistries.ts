/**
 * The ids in the AI gateway's two registries, read from the edge source.
 *
 * `supabase/functions/_shared/capabilityCatalog.ts` and `sessionMemory.ts` keep
 * their registries private — they export lookups (`getCapability`,
 * `sessionScopeForCapability`), not the tables. A test that must visit EVERY
 * entry ("no capability admits super_admin", "every session scope names a real
 * capability") needs the keys, and exporting them would change a module that
 * `ai-gateway` runs as deployed. So the keys are read from the file's text and
 * each one is proved against the module's own lookup: an id the parser invents
 * resolves to nothing and the caller's assertion fails, and a parser that finds
 * nothing is refused here outright.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function blockKeys(file: string, opener: string, minimum: number): string[] {
  const text = readFileSync(join(process.cwd(), "supabase/functions/_shared", file), "utf8");
  const start = text.indexOf(opener);
  if (start < 0) throw new Error(`${file}: "${opener}" not found — the registry moved`);
  const end = text.indexOf("\n};", start);
  if (end < 0) throw new Error(`${file}: the registry after "${opener}" never closes`);
  const keys = [...text.slice(start, end).matchAll(/^ {2}"([a-z_.]+)":/gm)].map((m) => m[1]);
  if (keys.length < minimum) {
    throw new Error(`${file}: read ${keys.length} key(s), expected at least ${minimum}`);
  }
  return keys;
}

/** Every feature id in the edge capability catalogue. */
export function edgeCapabilityIds(): string[] {
  return blockKeys("capabilityCatalog.ts", "const CAPABILITY_CATALOG", 20);
}

/** Every capability the edge session memory admits. */
export function edgeSessionMemoryIds(): string[] {
  return blockKeys("sessionMemory.ts", "const SESSION_MEMORY_CAPABILITIES", 10);
}
