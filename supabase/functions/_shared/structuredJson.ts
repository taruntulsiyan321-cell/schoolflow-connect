/**
 * The two pure halves of a structured completion, kept free of Deno so they
 * can be tested: what the prompt shows the model, and how the reply is read.
 */

/**
 * What a structured prompt shows the model: an EXAMPLE of the answer, not the
 * JSON Schema that describes it.
 *
 * structuredCompletion folds the schema into the prompt as text ("matching
 * this shape: …"), because OpenRouter/Qwen has no native schema enforcement.
 * Shown a JSON Schema, the model often answers IN it — it echoes `type`,
 * `properties` and `items` back, or returns the shape of the schema rather
 * than the shape it describes. Measured 2026-09-24 on ai-recovery-variants:
 * 6 of 10 answer checks came back with no answer for the one question asked
 * ("answer check returned nothing for this variant"), so no variant was
 * stored and a CUET student's recovery could never open. Nova's revision
 * prompts had already hit the same thing and been moved to example shapes by
 * hand; this is that fix, once, for every caller.
 *
 * An object that is not a JSON Schema (an example shape already) is returned
 * as it is.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const PRIMITIVES = new Set(["string", "integer", "number", "boolean", "array", "object", "null"]);

function isSchema(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const t = (v as Record<string, unknown>).type;
  const type = Array.isArray(t) ? t.find((x) => x !== "null") : t;
  return typeof type === "string" && PRIMITIVES.has(type);
}

function exampleOf(schema: unknown): Json {
  if (!isSchema(schema)) return (schema ?? null) as Json;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0] as Json;
  const t = schema.type;
  const type = Array.isArray(t) ? (t.find((x) => x !== "null") as string) : (t as string);
  switch (type) {
    case "object": {
      const props = (schema.properties ?? {}) as Record<string, unknown>;
      const out: { [k: string]: Json } = {};
      for (const [k, v] of Object.entries(props)) out[k] = exampleOf(v);
      return out;
    }
    // One item, so the model sees what an element looks like.
    case "array":
      return schema.items === undefined ? [] : [exampleOf(schema.items)];
    case "integer":
    case "number":
      return typeof schema.minimum === "number" && schema.minimum > 0 ? schema.minimum : 0;
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return "";
  }
}

/** The example to show for `schema`; `schema` itself when it is already an example. */
export function schemaShape(schema: Record<string, unknown>): Json {
  return isSchema(schema) ? exampleOf(schema) : (schema as Json);
}

/**
 * The JSON object in a reply. A model asked for "ONLY JSON" still sometimes
 * wraps it — a fence, a sentence before it, a note after — and each of those
 * failed the whole call as "invalid JSON". The object is the span from the
 * first "{" to the last "}"; anything outside it is not part of the answer.
 */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body) as T;
  } catch (e) {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) throw e;
    return JSON.parse(body.slice(start, end + 1)) as T;
  }
}

/** Every "could not parse" starts with this; the cause follows in brackets. */
export const INVALID_JSON = "Model returned invalid JSON";
