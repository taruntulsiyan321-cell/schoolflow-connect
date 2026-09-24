/**
 * Generate §4.5 refusal-battery + positive-control fixtures under e2e-evidence/fixtures/custom-practice/.
 * Pure Node — no secrets. PNGs are intentionally simple; the live classifier must still refuse them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

const OUT = join("e2e-evidence", "fixtures", "custom-practice");
mkdirSync(OUT, { recursive: true });

/** Minimal RGB PNG (no deps). */
function pngRgb(width, height, paint) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = y * (width * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const compressed = deflateSync(raw);
  function chunk(type, data) {
    const typeBuf = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcBuf = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcBuf) >>> 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    return ~c;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Six refuse fixtures ─────────────────────────────────────────────────────
writeFileSync(
  join(OUT, "refuse-timetable.png"),
  pngRgb(640, 480, (x, y) => {
    // Grid like a timetable
    if (x % 80 < 2 || y % 60 < 2) return [40, 40, 40];
    if (y < 40) return [200, 220, 255];
    return [245, 245, 245];
  }),
);

writeFileSync(
  join(OUT, "refuse-blurry-dark.png"),
  pngRgb(512, 640, () => {
    const v = 8 + Math.floor(Math.random() * 12);
    return [v, v, v];
  }),
);

writeFileSync(
  join(OUT, "refuse-prose.png"),
  pngRgb(600, 800, (x, y) => {
    // Horizontal text-like bars (paragraphs), not MCQ options
    if (y > 80 && y < 700 && x > 40 && x < 560 && y % 28 > 8 && y % 28 < 18) return [30, 30, 30];
    return [252, 252, 248];
  }),
);

writeFileSync(
  join(OUT, "refuse-receipt.png"),
  pngRgb(400, 700, (x, y) => {
    if (y < 50) return [20, 20, 20];
    if (y > 80 && y < 120 && x > 20 && x < 380) return [20, 20, 20];
    if (y > 200 && y % 22 < 10 && x > 20 && x < 200) return [40, 40, 40];
    if (y > 200 && y % 22 < 10 && x > 250 && x < 360) return [40, 40, 40];
    return [255, 255, 255];
  }),
);

writeFileSync(
  join(OUT, "refuse-blank.png"),
  pngRgb(512, 640, () => [255, 255, 255]),
);

writeFileSync(
  join(OUT, "refuse-chat.png"),
  pngRgb(480, 800, (x, y) => {
    // Chat bubbles
    const row = Math.floor((y - 40) / 70);
    if (row < 0 || row > 9) return [230, 230, 235];
    const left = row % 2 === 0;
    if (left && x > 20 && x < 280 && y % 70 > 10 && y % 70 < 50) return [220, 248, 198];
    if (!left && x > 200 && x < 460 && y % 70 > 10 && y % 70 < 50) return [255, 255, 255];
    return [230, 230, 235];
  }),
);

// ── Positive control: multi-question MCQ as PDF text bytes ──────────────────
// A minimal PDF with extractable text (unpdf path). Enough questions for §4.4.
const mcqText = `
CUET Practice — Business Studies
Chapter: Nature and Significance of Management

Q1. Management is best described as:
A. A one-time activity
B. A continuous process
C. An optional hobby
D. A legal statute
Answer: B

Q2. Which is a function of management?
A. Planning
B. Cooking
C. Painting
D. Singing
Answer: A

Q3. Levels of management typically include:
A. Top, middle and operational
B. Only top
C. Only operational
D. None
Answer: A

Q4. Coordination in management means:
A. Ignoring departments
B. Integrating activities towards goals
C. Random decisions
D. Avoiding communication
Answer: B

Q5. Efficiency means:
A. Doing the right things
B. Doing things right with minimum resources
C. Delaying work
D. Avoiding goals
Answer: B

Q6. Effectiveness means:
A. Doing the right things to achieve goals
B. Wasting resources
C. Ignoring outcomes
D. Maximising cost
Answer: A
`.trim();

// Minimal PDF 1.4 with a single text stream (Helvetica).
function simplePdf(text) {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const lines = escaped.split("\n");
  const contentLines = ["BT", "/F1 11 Tf", "50 750 Td", "14 TL"];
  for (const line of lines) {
    contentLines.push(`(${line}) Tj`, "T*");
  }
  contentLines.push("ET");
  const stream = contentLines.join("\n");
  const objs = [];
  objs.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  objs.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
  objs.push(
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
  );
  objs.push(`4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`);
  objs.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n");
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += o;
  }
  const xrefStart = Buffer.byteLength(body, "utf8");
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

writeFileSync(join(OUT, "accept-real-mcq-paper.pdf"), simplePdf(mcqText));

// Notes material for §12.3
const notesText = `
Study Notes — Accounting for Partnership (CUET Accountancy)

Topic: Capital Accounts
Partners maintain capital accounts. Fixed capital means capital stays constant;
current accounts record interest, salary, and share of profit.

Topic: Profit and Loss Appropriation
Net profit is appropriated: interest on capital, partner salary, then residual
profit shared in the agreed ratio.

Topic: Admission of a New Partner
A new partner may bring capital and goodwill. Revaluation of assets and
liabilities is recorded before admission.
`.trim();
writeFileSync(join(OUT, "accept-notes-partnership.pdf"), simplePdf(notesText));

writeFileSync(
  join(OUT, "README.md"),
  [
    "# Custom Practice evidence fixtures",
    "",
    "Binding: docs/custom-practice-upload-spec.md §4.5 / §12.1–§12.3",
    "",
    "| File | Expect |",
    "|---|---|",
    "| refuse-*.png | verdict unusable, zero downstream rows |",
    "| accept-real-mcq-paper.pdf | ready / questions (≥3) |",
    "| accept-notes-partnership.pdf | ready / notes (+ derived questions) |",
    "",
    "Regenerate: `node e2e-evidence/fixtures/custom-practice/generate.mjs`",
    "",
  ].join("\n"),
);

console.log("wrote fixtures to", OUT);
