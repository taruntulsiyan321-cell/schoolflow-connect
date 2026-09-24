import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    }),
);

const token = env.SUPABASE_ACCESS_TOKEN;
const ref = "psqxykzqfvxgsvkmgurn";
// `node q.mjs <file.sql>` or `node q.mjs -e "<sql>"` — the second is how
// scripts/lint-definer-doors.mjs calls it; reading "-e" as a file name made
// that gate fail with ENOENT before it checked anything.
const query = process.argv[2] === "-e" ? process.argv[3] : fs.readFileSync(process.argv[2], "utf8");
if (!query) {
  console.error('usage: node q.mjs <file.sql> | node q.mjs -e "<sql>"');
  process.exit(2);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query }),
});

const body = await res.json();
console.log(JSON.stringify(body, null, 2));
