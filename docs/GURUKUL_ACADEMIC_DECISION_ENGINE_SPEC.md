# The Gurukul Academic Decision Engine

**A design specification. No code, no SQL, no schema, no implementation.** Companion document to `GURUKUL_ACADEMIC_SIGNAL_ENGINE_SPEC.md`, which this document assumes and does not repeat.

Status: draft v1 — for review before any implementation work begins.

---

## 0. The Constitution

> **The Signal Engine is responsible for remembering. The Decision Engine is responsible for thinking. Product modules are responsible for acting.**

Unpacked, one layer at a time:

- **Evidence remembers** what happened.
- **Signals measure** what happened.
- **Learning Dimensions interpret** what happened, educationally.
- **Policies decide** what should happen next.
- **Modules act** on that decision.

Every section below exists to keep those five responsibilities from ever blurring into each other. That blurring — a module quietly computing its own version of a measurement, or a policy quietly inventing a new fact — is the single failure mode this whole two-document architecture exists to prevent, because it is the failure mode this codebase has already lived through once.

---

## 1. Relationship to the Signal Engine Document

The full picture is four layers, not two documents:

```
Evidence  ──┐
            ├── owned by GURUKUL_ACADEMIC_SIGNAL_ENGINE_SPEC.md (already written)
Signals   ──┘

Dimensions ──┐
             ├── owned by THIS document
Policies   ──┘
```

**Evidence** = the Signal Engine document's "raw facts" (§4 of that document) — the immutable `attempt_event` and its siblings. No math, no interpretation.

**Signals** = the Signal Engine document's "aggregated facts" and "derived facts" — `attempt_count`, `raw_accuracy`, `measurement_confidence`, `mastery_probability`, `half_life_estimate`, and everything else cataloged there. Mathematical. Still no judgment — the Signal Engine document's core rule ("the engine never decides weak or strong") holds exactly through this layer and no further.

**Learning Dimensions** (this document, §4) turn signals into educational meaning. This is where "what happened" becomes "what this probably means for the student's learning."

**Policies** (this document, §6–§8) turn educational meaning into a decision about what should happen next, expressed as a **Recommendation** (§7) — never a list, never a UI element, never a new fact.

One consequence worth stating plainly: **this document does not modify the Signal Engine document**, but it does place one requirement on Evidence that document didn't fully specify — every Evidence event should carry the full context chain active at the moment it happened (which teacher's class, which board, which exam cycle, which session), not only the concept it was tagged to. Without that, the multi-hop questions in §3 become expensive reconstructions later instead of graph traversals. This is noted here as a requirement on the layer below, not implemented here.

---

## 2. Core Principles (Additive to the Signal Engine's)

1. **The Decision Engine never invents data.** It reads Learning Dimensions (and, as a tracked exception, Signals directly — see §2.4). It never writes to Evidence or Signals, and it never stores a new fact about a student that didn't already exist one layer down.
2. **Dimensions are canonical. Policies are not.** A given Learning Dimension (e.g. "Understanding") is computed one way, once, versioned, and reused by every policy that reads it. Policies may *weight* dimensions differently for their own purpose — that's what makes Weak Areas and Recovery legitimately different despite reading overlapping dimensions — but no policy computes its own private version of a dimension. If a policy needs Understanding to mean something subtly different than the canonical definition, that's a signal a new, named dimension is needed, not a private reinterpretation.
3. **Policies produce Recommendations. Recommendations are data, not UI.** A Recommendation (§7) is a structured object with a type, a target, a machine-readable reason, and a priority. It has no color, no icon, no sort order relative to anything outside its own priority field, no layout. What a module does with a Recommendation — display it, queue it, speak it through Nova, aggregate it into a teacher's dashboard — is entirely that module's concern.
4. **Every policy is registered before it exists.** No policy is permitted to ship without an entry in the Policy Registry (§6.2). This is not documentation-after-the-fact; the registry entry — name, version, objective, dimensions used, thresholds, outputs, consumers — is treated as part of the policy's definition, the same way a function's signature is part of its definition.
5. **The escape hatch is tracked debt, not a side door.** A policy is occasionally going to need a Signal that no Dimension yet exposes. That's allowed, but every such read is logged in the policy's registry entry under a `raw_signal_reads` field, and it is treated as an open item — either the Dimension catalog needs a new entry, or the policy genuinely has a one-off need that never should have gone through a Dimension at all. This field existing and being nonempty for a policy is a standing signal to the platform team, not a permanent architecture.
6. **Nothing above raw Evidence and aggregated Signals is stored by default.** Learning Dimensions, Academic Profiles, and Recommendations are all computed at read time unless a specific one is explicitly declared cacheable, versioned, and timestamped — exactly the Signal Engine document's Derived-vs-Cached distinction, carried up through every layer of this document. This single rule is what keeps four layers from turning into four independently-drifting copies of the truth.
7. **A dimension or policy formula change is a version bump, never a silent overwrite.** History must be able to answer "what did the system believe on this date, computed by which formula" — this matters for audits, for parent/teacher trust, and for being able to tell a real change in student performance apart from a change in how performance is measured.

---

## 3. The Evidence Graph

The Signal Engine document models entities as a hierarchy (Question → Concept → Topic → Chapter → Subject → Student) because that's the correct shape for the aggregation rules that document is responsible for (§9–§11 of that document: what sums, what never averages). But aggregation and *query* are different problems, and the query shape Gurukul will eventually need is not a tree.

**The real entity set is a graph:**

```
Student ── attempted ──▶ Attempt ── of ──▶ Question ── tagged ──▶ Concept ── part of ──▶ Topic
                                                                                            │
Teacher ── teaches ──▶ Class ── studies ──▶ Curriculum ── belongs to ──▶ Board            │
                                                                                            ▼
School ── employs ──▶ Teacher                                                          Chapter ── part of ──▶ Subject
                                                                                            
Session ── contains ──▶ Attempt(s)          Exam ── scoped by ──▶ Curriculum, Time-window
Time ── indexes ──▶ every Evidence event
```

Nodes: Student, Attempt, Question, Concept, Topic, Chapter, Subject, Curriculum, Board, School, Teacher, Class, Session, Exam, Time. Edges are typed and directional (`attempted_by`, `tagged_with`, `part_of`, `teaches`, `taught_by`, `scoped_by`, `occurred_in`, `belongs_to`).

**Why this matters, using exactly the questions this architecture needs to survive being asked:**

- *"Show every Algebra concept taught by Teacher X that declines after 30 days"* — a traversal from Teacher → Class → Curriculum → Concept, filtered by a Learning Dimension (Growth Trend) computed per concept, per student, then aggregated back up to the teacher. Three hops before a single Dimension is even read.
- *"Which concepts become weak after holidays?"* — a traversal that joins the Time node's calendar structure (holiday windows) against Retention/Growth Trend dimensions across the whole Concept set. This is not answerable from any single entity's table; it requires walking Time and Concept together.
- *"Which chapters consistently cause slow solving in ICSE but not CBSE?"* — a traversal from Board → Curriculum → Chapter, comparing a Speed-related dimension across two Board-scoped populations of the same Chapter.

None of these are new architecture if the graph is explicit. All three are expensive, bespoke reconstructions if entities are only ever queried through their immediate table relationships.

**What this requires, stated as a design requirement, not a technology choice:** this document does not prescribe a graph database, a relational schema with recursive queries, or a precomputed traversal index — that's an implementation decision, correctly out of scope here. What it *does* require is that every Evidence event and every Learning Dimension be keyed with enough of this context (§1's note on context chains) that a multi-hop query is a traversal over existing typed relationships, not a reconstruction from partial data. Common traversal patterns (teacher → concept → dimension, board-vs-board comparison, time-windowed cohort analysis) should be expected to need precomputed/materialized paths at scale, the same way the Signal Engine document already pushes population-level item calibration to batch jobs rather than live computation (§18 of that document) — this is the same principle, applied to graph traversal instead of aggregation.

---

## 4. Learning Dimensions

A Learning Dimension answers one educational question, for one concept (or topic/chapter/subject/student, where the dimension is meaningful at that level — not all are), computed from one or more Signals, normalized to a consistent, comparable scale, and versioned.

**Normalization rule, applied to every dimension below:** dimensions are expressed on a 0–100 scale, but the scale is *always* shown alongside `evidence_strength` (§4, last row) or the underlying `measurement_confidence` it was built from. A dimension value computed from one attempt and a dimension value computed from two hundred are never displayed, compared, or fed into a policy without their confidence traveling with them — this is the Signal Engine document's Wilson-interval discipline (§7 of that document), inherited at this layer rather than re-solved.

| Dimension | Educational Question | Built From (Signals) | Valid Levels | Notes |
|---|---|---|---|---|
| **Understanding** | Does the student grasp *why*, not just *how*? | `mastery_probability` (BKT), `raw_accuracy`, weighted toward BKT once its confidence exceeds a version-pinned threshold, falling back to `raw_accuracy` before that | Concept → Student | The dimension that most needs the confidence caveat above — "Understanding: 82" from one lucky attempt is exactly the failure mode the whole architecture exists to prevent. |
| **Application Ability** | Can the student use the concept in a novel or word-problem context, not just recall it? | `accuracy` split by question cognitive-demand tag (conceptual / calculation / application — see the Signal Engine document §13.3's noted dependency), where that tag exists | Concept → Student | Deliberately separated from Understanding rather than folded in — this is what makes the Nova example ("good mastery, poor application → application questions only") possible at all. Blocked on the same question-metadata extension the Signal Engine document already flagged as a dependency, not designed here. |
| **Retention** | How much of what was learned is still accessible right now? | `retention_estimate` (derived from `half_life_estimate`), `forgetting_events_count` | Concept → Student | Always computed fresh — retention decays with time even with zero new evidence, so this dimension can change value on a day the student did nothing, which is expected and correct. |
| **Fluency** (Speed) | Is the student solving this efficiently, not just eventually correctly? | `avg_time_ms`, `time_on_correct_avg` vs. population `empirical` time distribution, `speed_trend` | Concept → Student | Normalized against the *item's* population time distribution (§10 of the Signal Engine document), not an absolute clock — 40 seconds is fast for one question type and slow for another. |
| **Consistency** | Is performance stable, or oscillating? | `volatility_index`, `consistency[difficulty]`, `consistency[time]` | Concept → Student | Directly the C-W-C-W-C-W vs. C-C-C-C-C-W distinction both design documents keep returning to — it earns its own dimension because no other dimension captures it. |
| **Difficulty Handling** | Where does performance break down as items get harder? | `accuracy_by_difficulty`, `difficulty_gap` | Concept → Student | Exposed as a profile (per-difficulty-band accuracy), not collapsed to one number, mirroring the Signal Engine document's explicit warning against collapsing what shouldn't be collapsed (§13.2 of that document). |
| **Practice Depth** | How much real engagement has this concept received? | `distinct_questions_attempted`, `attempts_total`, `practice_regularity` | Concept → Student | Breadth-aware on purpose — ten attempts at one question is shallow depth even with high attempt count. |
| **Recovery Need** | How urgently does this concept require remediation? | `current_status`, `repeated_recovery_count`, `forgetting_events_count`, inverse of `mastery_probability` | Concept → Student | High value = high need, by convention, chosen deliberately to match how it's used in the Weak Areas and Recovery policy examples (§8.1, §8.3) — a sign-flip here would silently invert every policy reading it. |
| **Growth Trend** | Is this concept improving, declining, or flat, right now? | `recent_accuracy_ewma`, `historical_accuracy_ewma`, `trend_delta` | Concept → Student | Signed, not just magnitude — a policy needs to know direction as much as rate. |
| **Evidence Strength** | How much can any of the above actually be trusted? | `measurement_confidence`, `attempts_total`, `distinct_questions_attempted` | Concept → Student | Not really "a dimension" in the educational sense — it's the confidence layer for every other dimension, promoted to first-class status because every policy needs to read it as often as it reads Understanding or Retention. |

**What is deliberately not a Learning Dimension:** anything that would require collapsing two or more of the above into one number (e.g. a single "Mastery" score combining Understanding + Retention + Consistency). That collapse is the Academic Profile object's job (§5), done explicitly and visibly, never smuggled in as if it were itself a primary measurement.

---

## 5. The Academic Profile ("Learning DNA")

A named, structured snapshot of every Learning Dimension for one entity (a concept, for one student) at one point in time.

```
Academic Profile
  entity_type: concept
  entity_id: <concept id>
  student_id: <student id>
  generated_at: <timestamp>
  dimension_formula_version: <version>

  understanding: 82        (evidence_strength: 96)
  application_ability: 61  (evidence_strength: 40)
  retention: 51             (evidence_strength: 96)
  fluency: 69                (evidence_strength: 88)
  consistency: 91            (evidence_strength: 96)
  difficulty_handling: 74    (evidence_strength: 70)
  practice_depth: 58
  recovery_need: 12
  growth_trend: +8
  evidence_strength: 96      (overall, per §4's normalization rule)
```

**This object belongs to the Decision Engine, not the Signal Engine — and this boundary is the single most important thing to get right about it.** Every value in it is already an interpretation (a Learning Dimension), not a raw measurement. If this object gets treated as authoritative — stored, cached indefinitely, read instead of its components — it becomes exactly the premature-collapse failure the Signal Engine document warned about in its own §13.2, just relocated one layer up and given a more compelling name. It is **always regenerable** from Signals via the versioned Dimension formulas, **never itself a source of truth**, and by default **not stored** (§2.6) — computed on read, cached only where a policy or product surface explicitly declares the need and accepts the staleness tradeoff.

**The Student Academic Genome** is the natural extension: the full set of Academic Profiles, one per concept, for one student, at one point in time — not a new object, just the complete collection, useful specifically because it can be visualized, diffed, and compared as a whole rather than concept-by-concept.

**Comparison and time-travel, and their real cost:**

- **Today vs. 3 months ago** requires either (a) a stored historical snapshot from 3 months ago, or (b) replaying Evidence up to that date and recomputing Dimensions as of then. The Signal Engine document's "never delete raw Evidence" rule (§15.11 of that document) is exactly what makes (b) *possible* — but replaying potentially years of Evidence for a popular concept is not free at 100 million attempts, and this document does not pretend otherwise. The practical answer is likely a hybrid: periodic (e.g. monthly) genome snapshots for cheap historical comparison at coarse granularity, with full replay available as a slower, exact fallback when precision matters (an audit, a parent dispute, a research question) — but this is a scalability decision for implementation, not resolved further in this design.
- **Student vs. topper, student vs. cohort** are computed **only at read time**, by whichever module needs the comparison (most likely Ranking or a Teacher/Parent Analytics surface) — never stored as a fact about either student. This is a direct, non-negotiable extension of the Signal Engine document's §15.6 (never store cross-student rank): a genome makes comparison *easy to compute*, which is exactly why it must not become *easy to accidentally start storing*.

---

## 6. Policies

### 6.1 The Policy Pattern

Every policy, without exception, has this shape:

```
Policy(student_id, scope)
  reads:    Learning Dimensions (canonical, §4) — and, as tracked debt, raw Signals (§2.5)
  applies:  policy-owned thresholds and weights (not shared, not canonical)
  produces: zero or more Recommendation objects (§7)

  NEVER:
    - writes to Evidence, Signals, or Dimensions
    - computes its own version of a canonical Dimension
    - knows anything about how its output will be displayed
```

A policy producing **zero** recommendations for a given student/scope is a normal, meaningful result ("no weak areas currently qualify"), not an error condition, and every consuming module must handle an empty result gracefully rather than assuming a policy always has something to say.

**Overlap between policies is expected, not a bug.** If Weak Areas and Recovery both surface the same concept, that's two independent, legitimate interpretations of the same underlying Dimensions agreeing — resolving or deduplicating that overlap for display (e.g. a combined "Today" screen) is a module-level UI decision, never something a policy adjusts its own logic to avoid.

### 6.2 The Policy Registry (Mandatory)

Every policy has exactly this entry, and no policy exists without one:

```
Policy Name:
Version:
Owner:
Objective:                    (which Academic Objective(s) this serves — §9)
Inputs (scope):                (student / class / concept-set / etc.)
Learning Dimensions Used:
Raw Signal Reads (tracked debt, §2.5):
Thresholds:
Outputs:                       (Recommendation type(s) produced)
Consumers:                     (which modules call this policy)
Explanation Template:
Cacheable:                      (yes/no; if yes, TTL and invalidation trigger)
Last Modified:
```

This is deliberately shaped like an API contract, because that is exactly what it is — the contract between "what the platform knows" and "what a module is allowed to act on."

### 6.3 Policy Catalog

Specified at the level this design operates at: objective, inputs, and decision logic in terms of Dimensions — not literal thresholds, which are implementation tuning, not architecture.

**Weak Areas**
- Objective: surface concepts most worth focused attention right now.
- Reads: `Recovery Need` (high), `Retention` (low), `Evidence Strength` (sufficient — this is what keeps a single unlucky attempt from qualifying).
- Produces: `Recommendation{type: weak_area}`, one per qualifying concept, priority driven by a combination of Recovery Need and how far Retention has fallen, not by raw accuracy.

**Recovery**
- Objective: identify concepts in active need of remediation, distinct from merely "not yet mastered."
- Reads: `Recovery Need` (high), `Consistency` (specifically, stability of *being wrong* — repeated failure, not a one-off), `Evidence Strength` (high — recovery should not fire on thin evidence), `Growth Trend` (flat or negative).
- Produces: `Recommendation{type: recovery}`.
- Differs from Weak Areas by requiring *repeated, stable* failure rather than merely low retention — the same Dimensions, different thresholds and different combination, exactly the separation this architecture is designed to make possible.

**Revision**
- Objective: identify concepts the student *understands* but is at risk of forgetting.
- Reads: `Understanding` (adequate-to-good), `Retention` (declining, via `Growth Trend` on the retention estimate specifically, or a short-horizon `days_until_retention_below(x)` read from the Signal layer), `Evidence Strength` (sufficient).
- Produces: `Recommendation{type: revision}`, priority driven by forgetting probability / urgency, not by how well the concept was ever understood.
- This is the clearest illustration of why Dimensions alone aren't Policies: Revision and Recovery both read Retention and Understanding, and produce opposite conclusions from opposite combinations of the same two dimensions.

**Strong Areas** *(the mirror image, not specified in the original brief but required for architectural symmetry — a system that only ever tells a student what's wrong is a worse product than one that also tells them what's working)*
- Objective: surface concepts genuinely ready to be built on, not just "not currently weak."
- Reads: `Understanding` (high), `Retention` (high), `Consistency` (high), `Evidence Strength` (high — a strong-area claim needs at least as much evidence backing it as a weak-area one, arguably more, since it will be used to justify moving *forward*).
- Produces: `Recommendation{type: strong_area}`, potentially feeding Adaptive Practice's decision to increase difficulty.

**Adaptive Practice (difficulty policy)**
- Objective: decide whether the next question served should be easier, harder, or the same difficulty.
- Reads: `Difficulty Handling` (current profile), `Fluency`, `Consistency`, `Evidence Strength`.
- Produces: `Recommendation{type: difficulty_adjustment}` scoped to a single upcoming question or short session, distinctly *not* a durable, dashboard-visible recommendation — this is the clearest case for a short-TTL or non-cacheable policy output (§2.6).

**Nova (explain-vs-test policy)**
- Objective: decide whether Nova's next interaction should teach, drill, or challenge.
- Reads: `Understanding`, `Application Ability`, `Fluency`, `Consistency` (volatility, specifically).
- Produces: `Recommendation{type: nova_action}` with a specific sub-type (`explain_fundamentals`, `teach_shortcut`, `application_questions`, `increase_spaced_repetition`), matching the four example rules given directly: high understanding + low speed → teach shortcuts; good speed + poor retention → increase spaced repetition; high volatility → explain fundamentals; good mastery + poor application → application questions only.

**Ranking**
- Objective: produce a comparative position for a student against a defined population, computed strictly at read time (§5, last paragraph).
- Reads: Student-level Academic Profile aggregates (not raw genomes of other students directly exposed — the comparison is computed, the underlying data of other students is not surfaced).
- Produces: `Recommendation{type: ranking_context}` or a direct read-model, depending on whether Ranking is better modeled as a policy at all — flagged here as an open question rather than resolved, since ranking may be closer to a pure read-time query than a "decision," and forcing it into the Recommendation shape may not be the right fit. Left for implementation-time judgment.

**Teacher Dashboard / Parent Dashboard / Analytics & Reports**
- Objective: aggregate and present, not individually decide — these consume the *outputs* of the above policies (and Academic Profiles directly) rather than being policies themselves in most cases. Where a genuinely new decision is needed (e.g. "which students in this class need the teacher's attention this week" is a real policy, not just a rollup), it gets its own registry entry, following the same pattern, rather than being folded silently into a dashboard's rendering code.

---

## 7. The Academic Recommendation Object

The canonical, UI-agnostic output of every policy:

```
Recommendation
  type:               (weak_area / recovery / revision / strong_area /
                        difficulty_adjustment / nova_action / ...)
  target:              (concept_id, or topic/chapter scope where applicable)
  student_id:
  reason:              { dimension: value, ... }   — structured, not prose
  explanation_text:     rendered from the policy's Explanation Template
                        + the reason payload — human-readable, still not
                        UI-styled
  priority:            normalized score, policy-defined scale
  policy_name:
  policy_version:
  generated_at:
  cacheable:           inherited from the policy's registry entry
  valid_until:          present only if cacheable
```

**Reason is structured data, not a string, by design** — a module needs to be able to sort, filter, or re-render recommendations by their underlying dimension values (e.g. a teacher dashboard grouping by "low retention" specifically) without parsing prose. `explanation_text` exists *alongside* the structured reason specifically so that Nova, a notification, or a dashboard tooltip all have a ready-made human sentence available without each independently inventing one — but it is generated by the policy's own Explanation Template, never by the consuming module guessing at phrasing.

**What a Recommendation is not:** it is not a queue item, not a notification, not a UI card. Whether a module shows it immediately, batches it into a daily digest, discards it if a higher-priority one exists for the same target, or never surfaces it directly at all (e.g. Adaptive Practice's output, consumed silently to pick the next question) is entirely that module's decision.

---

## 8. Academic Objectives

Every Learning Dimension and every Policy must trace to at least one objective. An idea that can't complete this row doesn't get built.

| Objective | Dimensions | Policies | Consuming Modules |
|---|---|---|---|
| Better understanding | Understanding, Application Ability | Weak Areas, Nova | Practice, Nova |
| Faster solving | Fluency | Adaptive Practice, Nova | Practice, Nova |
| Long-term memory | Retention, Growth Trend | Revision | Revision Planner |
| Consistency of performance | Consistency | Recovery, Nova | Recovery, Nova |
| Exam readiness | Difficulty Handling, Application Ability | Adaptive Practice, Strong Areas | Practice, Teacher Dashboard |
| Personalized teaching | Understanding, Application Ability, Fluency, Consistency | Nova | Nova |
| Targeted remediation | Recovery Need, Consistency, Evidence Strength | Recovery | Recovery |
| Timely revision | Retention, Growth Trend | Revision | Revision Planner |
| Motivation / visible progress | Growth Trend, Practice Depth | Strong Areas | Student Dashboard |
| Comparative context | (student-level aggregates) | Ranking | Ranking, Teacher/Parent Analytics |

Enforcement rule, stated plainly: a proposed Learning Dimension or Policy that cannot be placed in this table — that doesn't serve a named objective, through a real consumer — does not get built. This is the direct answer to "interesting but useless analytics accumulating over time," and it is meant to be applied at design-review time, before any implementation work, the same way this whole two-document exercise is being applied before Cursor writes a line of code.

---

## 9. Boundaries and Non-Goals

Restated at this layer because it is the layer most tempted to violate them:

- **No new raw facts.** If a policy needs something Evidence doesn't capture, that's a Signal Engine change request, not something computed inline here.
- **No stored cross-student comparisons.** Ranking and any "vs. topper" feature computes at read time, every time, against an explicitly stated comparison population (§5).
- **No stored predictions presented as facts.** If a policy's output is ever treated as a prediction of a future outcome rather than a recommendation for present action, it must be versioned and clearly distinguished from measured fact, per the Signal Engine document's §15.7 — carried forward unchanged at this layer.
- **No UI logic in policies.** Covered at length in §7; restated here because it's the boundary most likely to erode first under normal product pressure ("just add a color field to the recommendation, it's easier").
- **No policy without a registry entry.** Not aspirational — a policy without §6.2's entry is not considered to exist, for the purposes of this architecture, regardless of whether code implementing it has shipped.
- **Dimensions are computed, not authored per-policy.** A policy that needs a variant of an existing dimension proposes a new named dimension through the catalog (§4), it does not fork the existing one privately.

---

## 10. Risks

- **Recommendation churn from formula changes.** A Dimension formula version bump can change many Recommendations at once, which is correct (§2.7) but can read to a student or teacher as arbitrary flip-flopping if it happens often. Worth a stability policy at the product level (e.g. a minimum interval between formula-driven recommendation changes for the same target) — not resolved in this document, flagged for product design.
- **Registry discipline decaying under deadline pressure.** The single biggest risk to this whole architecture is a team shipping a policy without a registry entry "just this once" because a release is due. This is a process risk, not a design one, but it is the risk most likely to actually materialize, and it is worth naming explicitly rather than assuming good behavior.
- **Escape-hatch signal reads proliferating quietly.** §2.5's tracked-debt field only works if someone actually reviews it periodically and promotes overdue reads into proper Dimensions. Left unattended, it becomes exactly the kind of undisciplined direct-signal access this whole layer exists to prevent.
- **The observer effect.** A policy's recommendation changes what a student practices, which generates new Evidence, which feeds back into the Signals and Dimensions that produced the recommendation in the first place. This is not necessarily harmful (it's arguably the whole point — the system should influence behavior productively) but it means Dimension trends for heavily-recommended concepts are not neutral observations of "what the student would have done anyway." Worth being explicit about when this data is later used for anything resembling research or model evaluation.
- **Evidence Graph query cost at scale**, per §3 — anticipated and flagged, mitigation (precomputed traversal paths for common patterns) noted but not designed in depth here; a real implementation-time cost that shouldn't be discovered for the first time in production.

---

## 11. Edge Cases

- **Zero qualifying concepts for a policy.** Valid, expected, must be handled gracefully by every consumer (§6.1) — not an error, not a reason to lower thresholds automatically to force a result.
- **Overlapping recommendations across policies for the same target.** Expected (§6.1); resolution is a module/UI concern, not a policy-logic concern.
- **A Dimension undefined at the level a policy wants to operate at** (e.g. Recovery Need doesn't have a clean Subject-level meaning). The policy either restricts itself to the levels where the dimension is valid (§4's "Valid Levels" column) or operates on the underlying concept-level distribution directly (e.g. "count of concepts in this subject with high Recovery Need") rather than pretending a subject-level average of the dimension is meaningful.
- **A policy's thresholds need to differ by curriculum, board, or class level** (a "weak" retention threshold for a competitive-exam cohort may legitimately differ from a general one). Threshold parameterization by scope is expected and belongs inside the policy's own registered thresholds (§6.2), not as a new Dimension or a new copy of the policy.

---

## 12. Roadmap

- **Phase 1 (this specification):** Learning Dimensions computed live from Signals; hand-specified policies with fixed, registered thresholds; Recommendations computed on read, with caching only where explicitly declared.
- **Phase 2:** the recommendation feedback loop (§10, observer effect) — track whether a Recommendation was shown, acted on, or dismissed, as new Evidence flowing back into the Signal Engine. This is what eventually enables measuring whether a policy is actually effective, not just internally consistent.
- **Phase 3:** once Phase 2 produces enough feedback data, policy thresholds move from hand-set constants to tuned (and eventually possibly learned) values — but the *shape* of a policy (Dimensions in, Recommendation out, registered, versioned) does not change; only how its thresholds are set does. This is the direct test of whether this document's separation actually paid off: a policy becoming "smarter" should never require touching the Signal Engine.
- **Phase 4:** genuine Evidence Graph-native queries (§3's three example questions) as first-class product features, most plausibly surfaced through Nova, once traversal patterns are well enough understood from Phase 1–3 usage to justify precomputed indices for the common ones.

---

The Signal Engine remembers. This document's job is to make sure everything built on top of that memory thinks in the same language, for as long as Gurukul exists.
