# Custom Practice evidence fixtures

Binding: docs/custom-practice-upload-spec.md §4.5 / §12.1–§12.3

| File | Expect |
|---|---|
| refuse-*.png | verdict unusable, zero downstream rows |
| accept-real-mcq-paper.pdf | ready / questions (≥3) |
| accept-notes-partnership.pdf | ready / notes (+ derived questions) |

Regenerate: `node e2e-evidence/fixtures/custom-practice/generate.mjs`
