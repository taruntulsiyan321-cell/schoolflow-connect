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

// ── Two genuinely contentless fixtures ──────────────────────────────────────
// These two hold no information at all, by nature. Drawn as raw pixels.

writeFileSync(
  join(OUT, "refuse-blurry-dark.png"),
  pngRgb(512, 640, () => {
    const v = 8 + Math.floor(Math.random() * 12);
    return [v, v, v];
  }),
);

writeFileSync(
  join(OUT, "refuse-blank.png"),
  pngRgb(512, 640, () => [255, 255, 255]),
);

// ── Four fixtures that carry REAL TEXT ──────────────────────────────────────
//
// These were drawn as bars and blocks, and every one of them was refused for
// the wrong reason. Measured 2026-09-24, the live classifier's own words:
// "blank grid ... with no text", "only horizontal black bars", "abstract
// coloured bars and blocks with no readable text".
//
// So the battery proved the classifier rejects pictures with nothing written
// on them — which is not what §4.5 exists to prove. The dangerous upload is a
// page DENSE with real words that are not practice questions: a student
// photographing their actual timetable, full of subject names and times. That
// is the input a model is tempted to invent questions from, and it was never
// being asked.
//
// Rendered from HTML through the browser this repo already has, so the words
// are really on the page and really readable.

const { chromium } = await import("playwright");
const browser = await chromium.launch();

async function shot(name, width, height, html) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(
    `<html><body style="margin:0;font-family:Segoe UI,Arial,sans-serif">${html}</body></html>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: join(OUT, name) });
  await page.close();
}

const PERIODS = [
  ["1", "08:00", "Mathematics", "Mrs Sharma", "Room 12"],
  ["2", "08:50", "Physics", "Mr Iyer", "Lab 2"],
  ["3", "09:40", "Accountancy", "Mrs Nair", "Room 07"],
  ["4", "10:50", "Business Studies", "Mr Khan", "Room 09"],
  ["5", "11:40", "English", "Ms D'Souza", "Room 04"],
  ["6", "12:30", "Economics", "Mr Bose", "Room 11"],
];
await shot(
  "refuse-timetable.png",
  760,
  620,
  `<h2 style="padding:12px 16px;margin:0;background:#1e3a8a;color:#fff">Class XII-A — Weekly Timetable</h2>
   <p style="padding:8px 16px;margin:0;color:#334155">Term 2 · Effective 1 September 2026</p>
   <table style="width:100%;border-collapse:collapse;font-size:15px">
     <tr style="background:#e2e8f0"><th style="border:1px solid #94a3b8;padding:8px">Period</th><th style="border:1px solid #94a3b8;padding:8px">Time</th><th style="border:1px solid #94a3b8;padding:8px">Subject</th><th style="border:1px solid #94a3b8;padding:8px">Teacher</th><th style="border:1px solid #94a3b8;padding:8px">Room</th></tr>
     ${PERIODS.map(
       (r) =>
         `<tr>${r.map((c) => `<td style="border:1px solid #cbd5e1;padding:8px">${c}</td>`).join("")}</tr>`,
     ).join("")}
   </table>
   <p style="padding:12px 16px;color:#475569">Assembly every Monday at 07:45. Games period on Friday after Period 6.</p>`,
);

// Deliberately NOT about a CUET subject. The first version of this fixture was
// an article on the monsoon and the Indian economy, and the classifier was
// right to hesitate: for an Accountancy/Economics student that IS study
// material, and §7 says study material becomes notes. It was accepted on one
// run and refused on the next — a fixture that is genuinely ambiguous tests
// nothing except which way the coin landed. Ordinary prose means prose with no
// exam subject in it at all.
await shot(
  "refuse-prose.png",
  700,
  860,
  `<div style="padding:40px;font-size:17px;line-height:1.7;color:#111">
   <h3>The Long Way Round</h3>
   <p>Ravi had promised himself he would leave before the rain came, and of course he did not. By the
   time the bus wheezed into the depot the windows were streaked and the man beside him had fallen
   asleep on his shoulder twice, each time waking to apologise in a language neither of them spoke well.</p>
   <p>His aunt would be waiting at the far gate with an umbrella she refused to share, complaining about
   the traffic on the ring road and about his mother, in roughly that order. He had rehearsed his
   answers on the journey and forgotten every one of them somewhere past the toll plaza.</p>
   <p>The dog at the tea stall remembered him, which was more than could be said for the tea seller.
   It followed him to the gate, hopeful and unhurried, and turned back only when the umbrella came down
   between them like a verdict.</p>
   </div>`,
);

await shot(
  "refuse-receipt.png",
  420,
  700,
  `<div style="padding:24px;font-family:Consolas,monospace;font-size:15px;color:#111">
   <div style="text-align:center"><b>SHREE GENERAL STORE</b><br/>Shop 14, Mahavir Nagar<br/>GSTIN 27AABCS1429B1Z</div>
   <hr/>
   <div>Bill No: 40921 &nbsp; 24/09/2026 18:42</div><hr/>
   <table style="width:100%">
     <tr><td>Toor Dal 1kg</td><td align="right">184.00</td></tr>
     <tr><td>Sunflower Oil 1L</td><td align="right">142.50</td></tr>
     <tr><td>Atta 5kg</td><td align="right">265.00</td></tr>
     <tr><td>Milk 500ml x4</td><td align="right">108.00</td></tr>
     <tr><td>Notebook A4</td><td align="right">60.00</td></tr>
   </table>
   <hr/>
   <table style="width:100%">
     <tr><td>Subtotal</td><td align="right">759.50</td></tr>
     <tr><td>CGST 2.5%</td><td align="right">18.99</td></tr>
     <tr><td><b>TOTAL</b></td><td align="right"><b>797.48</b></td></tr>
   </table>
   <div style="text-align:center;margin-top:18px">Thank you. Goods once sold are not returnable.</div>
   </div>`,
);

const CHAT = [
  ["them", "did you finish the accounts homework"],
  ["me", "half of it only, partnership one is long"],
  ["them", "same. are we meeting at the library tomorrow"],
  ["me", "yes 4pm, bring your notes"],
  ["them", "ok. also ma'am said test is on monday"],
  ["me", "monday?? i thought wednesday"],
  ["them", "she changed it today in class"],
];
await shot(
  "refuse-chat.png",
  480,
  760,
  `<div style="background:#e5ddd5;height:100%;padding:12px">
   <div style="background:#075e54;color:#fff;margin:-12px -12px 12px;padding:12px 16px"><b>Ananya</b><br/><span style="font-size:12px">online</span></div>
   ${CHAT.map(
     ([who, text]) =>
       `<div style="display:flex;justify-content:${who === "me" ? "flex-end" : "flex-start"};margin:8px 0">
          <div style="max-width:70%;background:${who === "me" ? "#dcf8c6" : "#fff"};padding:8px 12px;border-radius:8px;font-size:15px">${text}</div>
        </div>`,
   ).join("")}
   </div>`,
);

await browser.close();

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
