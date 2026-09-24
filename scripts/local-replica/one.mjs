// Apply ONE migration file to the replica with psql semantics, printing NOTICEs.
//   node one.mjs <repo-root> <file.sql>
import { createRequire } from "module";
import { readFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
const [rootArg, file] = process.argv.slice(2);
const root = path.resolve(rootArg);
const pg = createRequire(path.join(root, "package.json"))("pg");
const { splitSql } = await import(pathToFileURL(path.join(root, "scripts/local-replica/splitSql.mjs")).href);
const c = new pg.Client({ host: "127.0.0.1", port: 5433, user: "postgres", database: "gurukul" });
c.on("notice", (n) => console.log(`NOTICE: ${n.message}`));
await c.connect();
const stmts = splitSql(readFileSync(path.resolve(root, file), "utf8"));
let i = 0;
try {
  for (const s of stmts) {
    i++;
    await c.query(s);
  }
  console.log(`OK ${path.basename(file)} — ${stmts.length} statements`);
} catch (e) {
  console.log(`FAIL at statement ${i}/${stmts.length}: ${e.message}${e.detail ? " | " + e.detail : ""}${e.where ? " | " + e.where : ""}`);
  console.log("   " + stmts[i - 1].replace(/\s+/g, " ").trim().slice(0, 200));
  process.exitCode = 1;
} finally {
  await c.end();
}
