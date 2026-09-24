/**
 * Measure §5.2 / §5.4 pixel thresholds against Stage-1 fixtures.
 * Ports MlKitOcrProvider meanAbsDelta / textInkDensity / verdictColourPresent.
 *
 *   node scripts/measure-screen-capture-funnel-thresholds.mjs
 *
 * Records numbers for docs/screen-capture-mistakes-spec.md §13 — not live PW
 * video, but the same PW-shaped stills the §12 floor already trusts.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "e2e-evidence/fixtures/screen-capture");

/** Current CaptureFunnel constants — must match Java. */
const LECTURE_DELTA_MIN = 0.12;
const LECTURE_TEXT_MAX = 0.04;
const QUESTION_TEXT_MIN = 0.008;

function textInkDensity(img) {
  const step = Math.max(1, Math.min(img.w, img.h) / 80);
  let dark = 0;
  let bright = 0;
  let n = 0;
  for (let y = 0; y < img.h; y += step) {
    for (let x = 0; x < img.w; x += step) {
      const i = (Math.floor(y) * img.w + Math.floor(x)) * 4;
      const lum = (img.rgba[i] + img.rgba[i + 1] + img.rgba[i + 2]) / 3;
      if (lum < 90) dark++;
      if (lum > 180) bright++;
      n++;
    }
  }
  if (n === 0) return 0;
  const d = dark / n;
  const b = bright / n;
  if (d > 0.55) return b;
  if (b > 0.55) return d;
  return Math.max(d, b);
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

/** Decode 8-bit RGB or RGBA PNG → { w, h, rgba Uint8Array }. */
function decodePng(buf) {
  if (buf[0] !== 0x89) fail("not a PNG");
  let o = 8;
  let w = 0;
  let h = 0;
  let bit = 0;
  let color = 0;
  const idats = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.slice(o + 4, o + 8).toString("ascii");
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bit = data[8];
      color = data[9];
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") break;
    o += 12 + len;
  }
  if (bit !== 8 || (color !== 2 && color !== 6)) {
    fail(`unsupported PNG bit=${bit} color=${color}`);
  }
  const bpp = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idats));
  const stride = w * bpp;
  const rgba = new Uint8Array(w * h * 4);
  let src = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[src++];
    const row = raw.subarray(src, src + stride);
    src += stride;
    const recon = Buffer.alloc(stride);
    const prev = y === 0 ? null : Buffer.alloc(stride);
    if (prev) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < bpp; c++) {
          prev[x * bpp + c] = rgba[((y - 1) * w + x) * 4 + c];
        }
      }
    }
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? recon[i - bpp] : 0;
      const up = prev ? prev[i] : 0;
      const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
      let val = row[i];
      if (filter === 1) val = (val + left) & 255;
      else if (filter === 2) val = (val + up) & 255;
      else if (filter === 3) val = (val + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        val = (val + pr) & 255;
      }
      recon[i] = val;
    }
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      rgba[di] = recon[x * bpp];
      rgba[di + 1] = recon[x * bpp + 1];
      rgba[di + 2] = recon[x * bpp + 2];
      rgba[di + 3] = bpp === 4 ? recon[x * bpp + 3] : 255;
    }
  }
  return { w, h, rgba };
}

function meanAbsDelta(a, b) {
  const w = Math.min(a.w, b.w);
  const h = Math.min(a.h, b.h);
  if (w < 2 || h < 2) return 1;
  const step = Math.max(1, Math.min(w, h) / 64);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const ia = (Math.floor(y) * a.w + Math.floor(x)) * 4;
      const ib = (Math.floor(y) * b.w + Math.floor(x)) * 4;
      sum +=
        Math.abs(a.rgba[ia] - b.rgba[ib]) +
        Math.abs(a.rgba[ia + 1] - b.rgba[ib + 1]) +
        Math.abs(a.rgba[ia + 2] - b.rgba[ib + 2]);
      n += 1;
    }
  }
  return n === 0 ? 1 : sum / (255 * 3) / n;
}

function verdictColourPresent(img) {
  const step = Math.max(1, Math.min(img.w, img.h) / 60);
  let redish = 0;
  let greenish = 0;
  for (let y = 0; y < img.h; y += step) {
    for (let x = 0; x < img.w; x += step) {
      const i = (Math.floor(y) * img.w + Math.floor(x)) * 4;
      const r = img.rgba[i];
      const g = img.rgba[i + 1];
      const b = img.rgba[i + 2];
      if (r > 160 && g < 100 && b < 100) redish++;
      if (g > 140 && r < 120 && b < 120) greenish++;
    }
  }
  return redish > 8 || greenish > 8;
}

function load(name) {
  const p = join(FIX, name);
  if (!existsSync(p)) fail(`missing ${name}`);
  return decodePng(readFileSync(p));
}

const wrong = load("must-wrong-instant.png");
const review = load("must-wrong-review.png");
const lecture = load("must-not-teacher-lecture.png");
const score = load("must-not-score-only.png");

const dens = {
  wrong: textInkDensity(wrong),
  review: textInkDensity(review),
  lecture: textInkDensity(lecture),
  score: textInkDensity(score),
};
const colour = {
  wrong: verdictColourPresent(wrong),
  review: verdictColourPresent(review),
  lecture: verdictColourPresent(lecture),
  score: verdictColourPresent(score),
};
const deltaWrongReview = meanAbsDelta(wrong, review);
const deltaWrongLecture = meanAbsDelta(wrong, lecture);
const deltaSelf = meanAbsDelta(wrong, wrong);

console.log("textInkDensity (dark/light-aware):", dens);
console.log("verdictColour:", colour);
console.log("delta wrong↔wrong:", deltaSelf.toFixed(4));
console.log("delta wrong↔review:", deltaWrongReview.toFixed(4));
console.log("delta wrong↔lecture:", deltaWrongLecture.toFixed(4));
console.log(
  "Java thresholds: LECTURE_DELTA_MIN",
  LECTURE_DELTA_MIN,
  "LECTURE_TEXT_MAX",
  LECTURE_TEXT_MAX,
  "QUESTION_TEXT_MIN",
  QUESTION_TEXT_MIN,
);

if (deltaSelf >= LECTURE_DELTA_MIN) fail("identical frames must not look like lecture motion");
if (dens.wrong < QUESTION_TEXT_MIN) {
  fail(`wrong instant textDensity=${dens.wrong} < QUESTION_TEXT_MIN`);
}
if (dens.review < QUESTION_TEXT_MIN) {
  fail(`review textDensity=${dens.review} < QUESTION_TEXT_MIN`);
}
if (deltaWrongLecture < LECTURE_DELTA_MIN) {
  console.log(
    "NOTE: still fixtures differ less than LECTURE_DELTA_MIN — live video motion is the §5.2 separator.",
  );
}
if (!colour.wrong) fail("must-wrong-instant should show verdict colour");
if (!colour.review) fail("must-wrong-review should show verdict colour");
if (colour.lecture) fail("teacher-lecture fixture must not show student verdict colour");

console.log("\nPASS threshold probe against §12 fixtures.");
console.log(
  `RECORD: LECTURE_DELTA_MIN=${LECTURE_DELTA_MIN} LECTURE_TEXT_MAX=${LECTURE_TEXT_MAX} QUESTION_TEXT_MIN=${QUESTION_TEXT_MIN}`,
);
console.log(
  `measured textDensity wrong=${dens.wrong.toFixed(4)} review=${dens.review.toFixed(4)} lecture=${dens.lecture.toFixed(4)}`,
);
process.exit(0);
