// node tpl.mjs <repo> save <name>   — template <name> := current gurukul
// node tpl.mjs <repo> load <name>   — gurukul := fresh copy of template <name>
import { createRequire } from "module";
import path from "path";
const [repoArg, mode, name] = process.argv.slice(2);
if (!/^[a-z0-9_]+$/.test(name ?? "")) throw new Error("template name must be [a-z0-9_]+");
const pg = createRequire(path.join(path.resolve(repoArg), "package.json"))("pg");
const c = new pg.Client({ host: "127.0.0.1", port: 5433, user: "postgres", database: "postgres" });
await c.connect();
if (mode === "save") {
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${name} TEMPLATE gurukul`);
} else if (mode === "load") {
  await c.query("DROP DATABASE IF EXISTS gurukul WITH (FORCE)");
  await c.query(`CREATE DATABASE gurukul TEMPLATE ${name}`);
} else throw new Error("mode must be save or load");
await c.end();
console.log(`${mode} ${name}`);
