/**
 * Split a SQL script into top-level statements, the way psql does.
 *
 * WHY THIS EXISTS
 *   The replica used to apply each migration with `psql -f`. psql sends one
 *   statement at a time in autocommit, and ON_ERROR_STOP stops at the first
 *   failure — so everything BEFORE the failing statement stays committed. That
 *   is load-bearing on a bare cluster: `20260604120000_demo_data.sql` fails part
 *   way through (it needs state only the live project had), and the classes,
 *   teachers and students it seeds before that point are the demo tenant every
 *   flow probe runs against.
 *
 *   Sending a whole file as one query instead makes it one transaction, and
 *   that single change took the replica from the documented 59 failed
 *   migrations to 106 — the seeded half vanished and everything built on it
 *   failed after it. Reproducing psql means splitting statements the way psql's
 *   lexer does, not on every `;`.
 *
 * A semicolon terminates a statement only outside:
 *   - '…' strings (with '' as an escaped quote), and E'…' strings, where a
 *     backslash also escapes
 *   - "…" identifiers
 *   - $tag$…$tag$ dollar quotes — every function and DO body in this repo
 *   - -- line comments and /* … *\/ block comments, which NEST in PostgreSQL
 * Comments are kept in the statement text; the server ignores them.
 */
export function splitSql(text) {
  // A UTF-8 BOM reaches the server as a literal character and is a syntax error
  // (20260802400000_fix_devanagari_mojibake.sql starts with one).
  const sql = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out = [];
  let start = 0;
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === "-" && next === "-") {
      const nl = sql.indexOf("\n", i + 2);
      i = nl === -1 ? n : nl + 1;
      continue;
    }

    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      continue;
    }

    if (c === "'") {
      // E'…' when the quote follows an E/e that is not itself part of a word.
      const prev = sql[i - 1];
      const beforePrev = sql[i - 2];
      const escapeString = (prev === "E" || prev === "e") && !/[A-Za-z0-9_]/.test(beforePrev ?? "");
      i++;
      while (i < n) {
        if (escapeString && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (c === "$") {
      // $tag$ where tag is empty or an identifier not starting with a digit.
      // `$1` is a positional parameter, not a quote.
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      const prevChar = sql[i - 1];
      if (m && !/[A-Za-z0-9_]/.test(prevChar ?? "")) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? n : close + tag.length;
        continue;
      }
      i++;
      continue;
    }

    if (c === ";") {
      const stmt = sql.slice(start, i + 1);
      if (stripComments(stmt).trim().replace(/;$/, "").trim()) out.push(stmt);
      start = i + 1;
      i++;
      continue;
    }

    i++;
  }

  const tail = sql.slice(start);
  if (stripComments(tail).trim()) out.push(tail);
  return out;
}

/** Used only to decide whether a chunk holds anything besides comments. */
function stripComments(s) {
  return s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
