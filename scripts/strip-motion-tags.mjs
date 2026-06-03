import fs from "fs";

for (const f of process.argv.slice(2)) {
  let t = fs.readFileSync(f, "utf8");
  t = t.replace(/<motion[A-Za-z]+[^>]*>/g, "<motionPlaceholder>");
  t = t.replace(/<\/motion[A-Za-z]+>/g, "</motionPlaceholder>");
  t = t.replace(/<motionPlaceholder>/g, "<div>");
  t = t.replace(/<\/motionPlaceholder>/g, "</div>");
  fs.writeFileSync(f, t);
  console.log("fixed", f);
}
