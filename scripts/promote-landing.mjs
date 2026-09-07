/**
 * After Vite build: make the Gurukul marketing page the real `/` document
 * (so Google/crawlers see it), and keep the SPA at `/app.html`.
 */
import { copyFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");
const spa = join(dist, "index.html");
const app = join(dist, "app.html");
const landing = join(dist, "landing.html");

if (!existsSync(spa)) {
  console.error("promote-landing: dist/index.html missing");
  process.exit(1);
}
if (!existsSync(landing)) {
  console.error("promote-landing: dist/landing.html missing — put it in public/");
  process.exit(1);
}

renameSync(spa, app);
copyFileSync(landing, spa);
console.log("promote-landing: / → landing.html, SPA → /app.html");
