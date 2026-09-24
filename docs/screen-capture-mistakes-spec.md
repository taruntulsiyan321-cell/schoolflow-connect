# Mistakes captured from another app's screen

**Status:** Stage 1 (tap) green 2026-09-24. Stage 2 (§5 on-device funnel)
landed — one watch session + four phone-side gates + reliability queue /
cooldown / overlay. Third of the three features that must exist before launch,
beside `docs/custom-practice-upload-spec.md`.

Facts marked *measured* were taken from the live database or this repository on
2026-09-24. Facts marked **VERIFY** are platform or policy facts that move, and
must be re-checked against the current Android release and current Play policy
before anything is designed on top of them — they are the author's knowledge,
not a measurement.

---

## §1 What this is

A student preparing for CUET does most of their solving somewhere else — on
Physics Wallah, on Unacademy. Gurukul cannot see any of it, so their mistake
book, their recovery and their revision know nothing about the work they
actually did.

This feature closes that. The student turns Gurukul on once; from then on,
**every question they get wrong inside PW lands in their Gurukul mistake book
by itself**, tagged, and feeding recovery, revision and analysis exactly like a
question they answered inside Gurukul.

They do nothing else. That is the whole product promise, and every decision
below is in service of it being *true* rather than nearly true.

---

## §2 What this shares with the upload feature — do not restate it

This feature and `docs/custom-practice-upload-spec.md` produce **the same
thing**: a question that is private to one student, tagged to a real chapter,
flowing into the mistake book. Only the intake differs — a file there, a screen
here.

So the rules below are defined **once**, in the upload spec, and this feature
obeys them without a second copy:

| rule | lives at |
|---|---|
| The privacy rule — an upload belongs to the account it came from | upload spec §2 |
| Why private questions are not in `question_bank` / `ai_kms_documents` | upload spec §2.1, §2.2 |
| Tagging, and resolving to a **real** `chapter_id` rather than guessing | upload spec §5, §5.1 |
| Marking an AI-derived answer, and letting the student dispute it | upload spec §6 |
| How mistakes, recovery, revision and analysis consume it | upload spec §9 |

A second copy of any of those in this document, or in code, is the defect RULE
0 exists to prevent. Cite them; do not repeat them.

---

## §3 Platform reality

**§3.1 This cannot be a web feature.** A web page can capture a screen only on
a desktop browser. On a phone, a website can never see another app. That is an
operating-system rule, not something to engineer around.

**§3.2 Android first.** *Measured:* this repo already ships a native shell —
`@capacitor/android`, `@capacitor/ios` and `@capacitor/push-notifications` are
dependencies, `capacitor.config.ts` exists, and an `android/` project is
present. There is **no `ios/` project**. Android screen capture
(`MediaProjection`) can see other apps.

**§3.3 iOS is possible and is version two.** The mechanism is a **ReplayKit
Broadcast Upload Extension** — the same one Zoom and Discord use; it genuinely
sees other apps and is App Store sanctioned. Two constraints shape it: the
extension runs in a **~50 MB memory process**, so frames must be downscaled and
handed off rather than processed in place; and the student must start the
broadcast themselves each session, with a visible indicator. It is native Swift
work in a new Xcode target, not a plugin install. **VERIFY** before building.

**§3.4 Do not start iOS until Android has proved §6 and §7.** The hard part is
reading a screen correctly, and it is identical on both. Debugging a 50 MB
process and an unproven reader at the same time is two unknowns at once.

---

## §4 What the student turns on

**Once**, not per session:

- **Screen capture** — Android shows a system consent dialog and a persistent
  notification while it is active. The notification cannot be hidden and should
  not be.
- **Usage access** — the permission granted in Settings that lets an app see
  which app is in the foreground. The same one screen-time and parental-control
  apps use.
- **The app list** — the student picks which apps this applies to. PW at
  launch. Nothing captures from an app they did not choose.

**§4.1 Why one consent and not one per app-open.** **VERIFY:** from Android 14,
each screen-capture session needs its own user consent, and an app cannot start
one from the background. So "start capturing when PW opens" would mean a system
dialog every time the student opens PW. The design is therefore: **one capture
session, and the filtering decides what is looked at** (§5) — not one session
per app.

---

## §5 The funnel on the phone — and everything here is free

Nothing in this section costs money, uses the network, or leaves the device.
This is the section that decides whether the feature costs pennies or dollars
per student (§8).

**§5.1 Which app is in front.** Not on the student's list → the frame is
dropped immediately. Not read, not text-recognised, not stored, not sent.
WhatsApp, the gallery, a banking app: never examined at all.

**§5.2 Is this a lecture?** Students watch classes in PW as much as they solve
in it. A playing video **changes constantly and carries very little text**; a
question **sits still and is mostly text**. Frame-to-frame difference plus a
text count separates them, with no AI. Lectures never leave the phone.

This is also the largest cost saving in the feature: moving video produces a
new distinct frame every moment, so lectures are precisely the frames that
would otherwise dominate the bill.

**§5.3 The verdict trigger — not a timer.** The capture moment is **the moment
a right/wrong verdict appears next to the student's own answer**. Detect it as
a screen change where red/green appears, or where verdict words appear
("Correct answer", "Your answer", "Solution", a score line).

A fixed timer is wrong here. In PW's instant mode (§6.1) a wrong answer may be
on screen for only a second or two before the student taps Next, and a
three-second timer would miss it. Missing mistakes is the one failure this
feature cannot afford.

**§5.4 Does the text look like a question with a verdict?** On-device text
recognition (Android ML Kit — free, offline, no AI cost) reads the frame. If
the text does not look like a question **and** a verdict, it is dropped here.

Only what survives all four gates goes any further.

---

## §6 The two shapes of PW — from the owner, who uses it daily

**§6.1 Instant.** The student answers, and PW shows right or wrong immediately,
on that question. The verdict screen appears on its own — nothing depends on
the student choosing to open anything. **This is the better case**, and §5.3's
trigger exists for it.

**§6.2 Test.** The student answers ten, submits, and the answers come
afterwards on a review screen. Everything needed is on that screen at once:
question, their answer, the correct answer, the verdict.

**§6.3 The one rule that covers both**, and will cover other apps without a
rewrite:

> Capture the screen that shows **the student's own answer** and a
> **right/wrong verdict** at the same time.

**§6.4 What must NOT be captured.** During a lecture, a teacher often solves a
question on screen. That is a question, but it is **not the student's mistake**.
Capturing it fills the mistake book with questions they never attempted, and
recovery then sends them to revise something they never got wrong — destroying
trust in the feature this one exists to feed. The verdict must be attached to
**the student's own answer**, not merely present on screen.

Likewise: if PW shows a DPP as a PDF with no marking at all, **nothing is
captured**. That gap is what the upload feature and the tap (§10) are for.

**§6.5 If the student never opens the solutions** in test mode, we see the
score but not which questions were wrong. Capture **nothing**, and say so
plainly — "open the solutions and Gurukul will pick up your mistakes". Guessing
which ones were wrong poisons the mistake book.

---

## §7 What the server does

**§7.1 Extract and confirm.** The AI reads the surviving frame and returns: the
question, the option the student chose, the correct option, and whether they
were wrong. It **confirms** a verdict the phone already suspected; it does not
decide from scratch.

**§7.2 Match our own bank first — this is the biggest accuracy win available.**
*Measured 2026-09-24:* **26,153 bank questions carry an embedding, and all
4,267 CUET questions do** (`embed_status = 'embedded'`). A vector search
function already exists: `match_question_bank(p_query_embedding vector,
p_class_level integer, p_school_id uuid, p_subjects text[], p_match_threshold
double precision, p_match_count integer)`.

So: embed the captured question and search the bank. **On a confident match,
inherit that question's chapter, topic and difficulty exactly** — no guessing
at all. Only with no match does the AI tag it fresh, under upload spec §5.

Upload spec §5.1 rules that a wrong chapter is worse than no chapter. This is
the cheapest way to be right rather than plausible, and it should be tried
before the AI is asked to classify anything.

*Note for the builder:* `match_question_bank` takes `p_class_level` and
`p_school_id` — it was written for school students. It needs an exam-scoped
path for CUET. Small, but not free.

**§7.3 Collapse duplicates.** In test mode the student scrolls, and the same
question appears in dozens of frames. Fingerprint the normalised question text
and keep one.

Against the existing mistake book, a repeat is **not a new row**: it increments
`times_wrong` and moves `last_wrong_at`. *Measured 2026-09-24:* the existing
code already behaves this way — a question Riya got wrong twice sits at
`times_wrong = 2` with one row.

**§7.4 Then it is simply a mistake.** Same table, same recovery, same revision,
same analysis, per upload spec §9. Attempts and mistakes are written with a
`source` that names this feature, so it can always be told apart from practice
done inside Gurukul.

---

## §8 Cost

The design decides the cost, not the model. **Prices move** — re-check before
billing claims. Figures below are for the model Stage 1 actually calls
(`qwen/qwen3.7-flash` via OpenRouter), checked **2026-09-24** against
https://openrouter.ai/qwen/qwen3.7-flash: **$0.03 / $0.13 per 1M** input/output
tokens. Earlier 2026-09-08 per-million notes in this section are superseded.

| path | per captured question (order of magnitude) |
|---|---|
| Text-heavy read (~1.5k in + ~0.4k out) | ~$0.0001 |
| With a downscaled screenshot (~2.5k in incl. image tokens + ~0.4k out) | ~$0.00013 |

A student capturing 50 mistakes a day, every day: **well under $0.25 a month**
(~$0.20 at the image rate above).

Streaming frames to the AI instead — one a second for two hours a day — is
roughly **$8–25 per student per month** at these rates (same feature without
§5). The funnel is what keeps the bill in the first band.

**§8.1 The student's mobile data matters more than our bill.** Sending images
costs *them*. On-device filtering means a few kilobytes an hour instead of
megabytes. For a student on a limited pack, this is a reason to uninstall, and
it is the strongest argument for §5.

**§8.2 The real cost is one-off:** the native Android work. The running cost,
built this way, is close to nothing.

---

## §9 Promotion is OFF for this feature

The upload spec (§10) allows a *generated variant* of a student's own uploaded
question to enter the shared bank behind four gates. **That does not apply
here, at all.**

Questions captured from PW are another company's paid content. Keeping them
private to the one student who was already looking at them is defensible.
Feeding anything derived from them into a bank served to every school is not.

**Nothing captured by this feature, and nothing generated from it, ever enters
`public.question_bank`.** No gates, no exceptions, no review queue. If that
ruling is ever revisited, it is revisited here and nowhere else.

---

## §10 Build order

**§10.1 The tap comes first.** Before any automatic watching: a floating
Gurukul button over other apps, or the share sheet. The student taps when they
get one wrong; that frame is captured and goes through §7 unchanged.

This is not a lesser version. It is how §6 and §7 get proved cheaply, because a
student-chosen frame is *certainly* the right screen, while automatic watching
must find the few frames that matter among thousands. Running an unproven
reader automatically fills the mistake book with junk, and **a wrong mistake
book is worse than a thin one** — it corrupts recovery and revision, the exact
features this exists to feed.

**§10.2 Then automatic watching**, over a pipeline already known to be right.

**§10.3 Keep the tap afterwards**, for students who would rather nothing
watched at all.

**§10.4 The owner is the tester.** He solves PW daily and will notice a missed
mistake faster than any written test. Automated checks in §12 are the floor,
not the ceiling.

---

## §11 Privacy — what is never stored

- **Raw frames are never persisted.** The extracted question is kept; the
  picture of the student's screen is not. Cheaper, and the difference between
  holding a question and holding a recording of someone's phone.
- Frames from apps not on the list are dropped before they are read at all
  (§5.1).
- Lecture frames never leave the device (§5.2).
- The capture notification stays visible the whole time it is active.
- The student can turn it off, and can delete any captured question.

---

## §12 Acceptance

Every check needs something that can make it fail. A suite that only ever sees
a real wrong answer proves nothing.

**Must be captured:**
1. A wrong answer in PW **instant** mode, on screen for under two seconds.
2. A wrong answer in PW **test** mode, from the review screen after submitting.
3. A question that matches our CUET bank — and it must inherit that question's
   chapter, **not** a freshly guessed one (§7.2).

**Must NOT be captured — these are the real test:**
4. A **correct** answer.
5. A question a **teacher solves during a lecture** (§6.4).
6. Anything at all while a **lecture is playing** (§5.2).
7. Anything at all from an app **not on the student's list** — open WhatsApp
   and a gallery mid-session and assert nothing was read, not merely that
   nothing was stored (§5.1).
8. A score-only screen with no per-question verdict (§6.5).

**Must behave:**
9. Scrolling a ten-question review produces **ten** mistake entries, not
   dozens (§7.3).
10. The same question wrong twice produces **one row with `times_wrong = 2`**,
    not two rows.
11. A captured mistake appears in the mistake book, is counted by recovery,
    scheduled by revision, and included in analysis — each asserted on
    content, as the student, not on a row count. *(A count that stays the same
    cannot tell a correct increment from a silent write failure — that
    happened in the 2026-09-24 acceptance run.)*
12. **Nothing** reached `public.question_bank` (§9). Assert the count before
    and after a full session.

---

## §13 Still open / measured

### VERIFY — Android + Play (checked 2026-09-24 against current docs)

| fact | result | implication for §4 / Stage 1 |
|---|---|---|
| MediaProjection consent | **Confirmed:** Android 14+ requires user grant via `createScreenCaptureIntent()` before a `mediaProjection` FGS may start; consent is per capture session, not a one-time install grant. Apps cannot start projection from the background. | Stage 1 tap: request consent on first tap (or when starting overlay session), then one-shot capture. Do not design “silent start when PW opens”. |
| FGS type | **Confirmed:** declare `FOREGROUND_SERVICE_MEDIA_PROJECTION`, service `android:foregroundServiceType="mediaProjection"`, start typed FGS *after* grant, then `getMediaProjection()`. | Manifest + one-shot capture service. |
| Play Console | **Confirmed:** apps targeting Android 14+ must declare the Media Projection FGS use on App content (Policy), with user-beneficial / user-initiated / stoppable justification and a demo video. Device and Network Abuse policy applies. | Ship Stage 1 as explicit tap-initiated capture; keep the system capture notification visible (§11). |
| Usage access | Still required for Stage 2 §5.1 foreground-app filtering. **Stage 1 tap does not need it** — the student chooses the moment; the phone still sends `package_name` when known, and the server/client allowlist drops unlisted apps before any read. | Do not request usage-access until Stage 2. |
| Android 15 | Media-projection stop chip / tighter stop UX — treat as product copy, not a blocker for Stage 1. | — |

### VERIFY — Stage 2 usage-access + watching (checked 2026-09-24 against current docs)

| fact | result | implication for §5 |
|---|---|---|
| `PACKAGE_USAGE_STATS` | **Confirmed:** special (AppOps) permission — declare in manifest; user grants via `Settings.ACTION_USAGE_ACCESS_SETTINGS`, not a runtime dialog. Required to query other apps' foreground state via `UsageStatsManager`. | Stage 2 §5.1: open Settings once; refuse to start the watch session until granted. |
| Play / sensitive APIs | **Confirmed:** Play's Permissions Declaration Form targets listed high-risk permissions (SMS, Call Log, etc.). `PACKAGE_USAGE_STATS` is not on that form, but it is a **sensitive API** under "Permissions and APIs that access sensitive information" — must be necessary for a promoted core feature, user-consented, not used for undisclosed purposes. MediaProjection FGS still needs the Play Console FGS declaration above. | Justify usage-access only for "which allowlisted study app is in front"; never for ads or profiling. Keep the capture notification visible. |
| One session (§4.1) | **Reconfirmed:** Android 14+ MediaProjection consent is per session; cannot start from background. Android 15: `BOOT_COMPLETED` cannot start `mediaProjection` FGS; starting an FGS from the background while holding `SYSTEM_ALERT_WINDOW` requires a **visible** overlay window first. | Student starts **one** watch session from the app (consent + FGS). Keep the Stage 1 overlay visible so Android 15 allows the FGS. Filtering decides what is looked at — never "start silent when PW opens". |
| Cost (§8) | **Confirmed (2026-09-24):** live path is `qwen/qwen3.7-flash` via OpenRouter at $0.03/$0.13 per 1M in/out. Order-of-magnitude ~$0.00013 per image capture → ~$0.20/mo at 50 mistakes/day (under $0.25). Streaming ~1 fps for 2h/day is an order of magnitude higher ($8–25). Prices still move — re-check the OpenRouter page before citing dollars. Funnel proof is frames-sent/hour, not the dollar string. | Instrument `sent`; report frames-sent per hour of realistic use (`measure-screen-capture-stage2-cost.mjs` + androidTest). |

Stage 1 §12 must stay green while Stage 2 lands. The Stage 1 tap path is unchanged.
On this worktree (2026-09-24): JVM `CaptureFunnelTest` **9/9 PASS**; on-device
`CaptureFunnelInstrumentedTest` **9/9 PASS** via
`./gradlew :app:connectedDebugAndroidTest` on AVD `medium_phone`
(sdk_gphone64_x86_64 / Android 16). Portable SDK/JDK under
`%LOCALAPPDATA%\gurukul-tools\` (not committed; `android/local.properties`
gitignored). `npx cap sync android` regenerates `capacitor.settings.gradle`.

Stage 2 reliability (same day, after first instrumented green):
- Watch SEND queue (native pending + JS upload queue) — no silent drop while busy
- 45s OCR-fingerprint send-cooldown (`DROP_RECENT_DUPLICATE`) — §8 cost
- Async OCR so the sample loop is not blocked for §12.1 instant windows
- Android 15: overlay required + shown before watch FGS; tap blocked while watching
- `MediaProjection.Callback` → `watchSessionEnded`; Profile app-list + §11 delete
- §12.4/§12.5/§12.8 on-device: correct / teacher-solve / score-only drop at §5.4
  (wrong = Incorrect/wrong words OR Your answer letter ≠ Correct answer letter)

### Still open

- Which model reads the frames. Note that `ai-gateway` **cannot be deployed
  from this repo** — production holds two `_shared` modules that exist in no
  branch (KNOWN_ISSUES, edge-drift entry). Stage 1 uses a dedicated
  `screen-capture-mistake` function instead.
- The confidence thresholds in §5.2 and §5.4 are **measured 2026-09-24** against
  §12 PW-shaped fixtures (`scripts/measure-screen-capture-funnel-thresholds.mjs`):
  - `LECTURE_DELTA_MIN = 0.12` (live video motion; still fixtures differ ~0.05)
  - `LECTURE_TEXT_MAX = 0.04` / `QUESTION_TEXT_MIN = 0.008` after dark/light-aware
    glyph density (dark chrome must not count as ink — was ~0.97 before the fix)
  - §5.4 remains OCR `looksLikeQuestionWithVerdict` (question + verdict + Your answer)
  - Owner still re-tunes on real PW video (§10.4)
- Unacademy and the rest. The §6.3 rule should carry, but no one has looked at
  their screens yet. Do not assume.
- PW will redesign their app. Expect it; build §5.3 and §7.1 on what a screen
  *means* rather than where PW puts it today.
