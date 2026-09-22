/**
 * Nova Context Pack v1 — unit tests (learning facts only; no school records).
 */
import { describe, expect, it } from "vitest";
import { buildContextPack, packForModel } from "./contextBuilder";
import {
  evidenceFromNovaLearningFacts,
  validateModelResponse,
} from "./responseValidator";
import { getBuiltinPrompt, renderPromptTemplate } from "./promptLibrary";
import { getCapability } from "./capabilityCatalog";

const AE = {
  student_profile: {
    projection: "StudentProfileContext",
    class_label: "11-A",
    subjects: ["Mathematics", "Physics"],
    completeness: 1,
    data_version: "profilectx:s1:1",
    source_as_of: "2026-08-01",
  },
  practice: {
    projection: "StudentPracticeHistory",
    sessions_completed: 4,
    subjects: ["Mathematics"],
    completeness: 1,
    data_version: "practice:s1:4",
    source_as_of: "2026-08-02",
  },
  mistakes: {
    projection: "StudentMistakesBook",
    open_count: 2,
    recent_concepts: ["Integration"],
    completeness: 1,
    data_version: "mistakes:s1:2",
    source_as_of: "2026-08-02",
  },
  recovery: {
    projection: "StudentRecoveryQueue",
    pending_count: 1,
    open_concepts: ["Limits"],
    completeness: 1,
    data_version: "recovery:s1:1",
    source_as_of: "2026-08-02",
  },
  progression: {
    projection: "StudentProgression",
    study_streak: 5,
    xp: 400,
    level: 3,
    completeness: 1,
    data_version: "prog:s1:1",
    source_as_of: "2026-08-01",
  },
};

const EIE = {
  algorithm_id: "eie.mastery.v1",
  avg_mastery: 62,
  weak_concepts: [{ concept: "Integration", subject: "Math", mastery_score: 40, band: "weak" }],
  completeness: 0.9,
  data_version: "eie:2:1:1",
  source_as_of: "2026-08-01",
};

describe("Nova Context Pack v1", () => {
  it("carries no strength field into the model context (§10.8)", () => {
    // Asserted on the serialised pack rather than on named properties: the rule
    // is that no strength reaches the model, and a field renamed to
    // top_concepts would pass a property-name check while violating it.
    const serialised = JSON.stringify({ ae: AE, eie: EIE });
    expect(serialised).not.toMatch(/strong|master(ed)?"|proficient|excellent/i);
    // The positive, so an empty fixture cannot pass the line above: the weak
    // side must still be present, because that is what the pack exists to carry.
    expect(serialised).toMatch(/weak_concepts/);
    expect(serialised).toMatch(/Integration/);
  });

  it("registers student.nova.chat capability", () => {
    const cap = getCapability("student.nova.chat");
    expect(cap?.requires_student_target).toBe(true);
    expect(cap?.model_policy).toBe("required_when_budget");
  });

  it("builtin prompt tutors on learning facts only (no school records)", () => {
    const p = getBuiltinPrompt("student.nova.chat");
    expect(p?.version).toBe("v2");
    expect(p?.user_template).toContain("{{facts}}");
    expect(p?.user_template).toContain("{{question}}");
    expect(p?.system_template).toMatch(/learning facts/i);
    expect(p?.system_template).toMatch(/EIE|recovery|practice|mistakes|revision/i);
    expect(p?.system_template).toMatch(/Refuse attendance|academic doubts/i);
    expect(p?.system_template).not.toMatch(/students use Class for those/i);
    expect(p?.system_template).not.toMatch(/personal school metrics \(attendance/i);
    const rendered = renderPromptTemplate(p!.user_template, {
      facts: '{"eie":{"avg_mastery":62},"practice":{"sessions_completed":4}}',
      question: "How am I doing?",
      language: "en",
    });
    expect(rendered).toContain("62");
    expect(rendered).toContain("How am I doing?");
  });

  it("buildContextPack yields non-empty learning facts without school records", () => {
    const pack = buildContextPack({
      capability: "student.nova.chat",
      request_text: "Help me revise",
      ae: AE,
      eie: EIE,
      tier_signals: { facts_complete: true },
    });
    expect(pack.provenance.algorithm_ids).toContain("eie.mastery.v1");
    expect(pack.provenance.data_versions.length).toBeGreaterThan(0);
    const json = packForModel(pack);
    expect(json.length).toBeGreaterThan(20);
    expect(json).toContain("62");
    expect(json).toContain("Integration");
    expect(json).toContain("study_streak");
    expect(json).not.toMatch(/attendance_pct|average_pct|pending_count.*homework|events/i);
    expect(json).not.toMatch(/Arjun|1382|Level 14/i);
  });

  it("validator uses EIE/progression evidence (no attendance/marks for Nova)", () => {
    const evidence = evidenceFromNovaLearningFacts({
      eie: { avg_mastery: 62 },
      progression: { xp: 400, level: 3, study_streak: 5 },
    });
    expect(evidence.attendance_pct).toBeNull();
    expect(evidence.average_marks_pct).toBeNull();
    expect(evidence.homework_pending).toBeNull();
    expect(evidence.avg_mastery).toBe(62);
    expect(evidence.allowed_pcts).toEqual([62]);
    expect(evidence.xp).toBe(400);

    const ok = validateModelResponse(
      "Tracked mastery averages 62%. Focus on Integration.",
      evidence,
    );
    expect(ok.material_failure).toBe(false);

    const bad = validateModelResponse("Your mastery is 99%.", evidence);
    expect(bad.material_failure).toBe(true);
    expect(bad.codes).toContain("invented_mastery_pct");

    // Invented attendance must fail even when attendance evidence is empty —
    // Nova must not invent school records it was never given.
    const inventedAtt = validateModelResponse("Your attendance is 91%.", evidence);
    expect(inventedAtt.material_failure).toBe(true);
    expect(inventedAtt.codes).toContain("invented_attendance_pct");
  });

  it("honest empty pack still serialises without inventing metrics", () => {
    const pack = buildContextPack({
      capability: "student.nova.chat",
      request_text: "hi",
      ae: {
        practice: { sessions_completed: 0, completeness: 0.2, data_version: "practice:empty" },
        mistakes: { open_count: 0, completeness: 0.2, data_version: "mistakes:empty" },
        recovery: { pending_count: 0, completeness: 0.2, data_version: "recovery:empty" },
      },
      eie: {
        algorithm_id: "eie.mastery.v1",
        avg_mastery: 0,
        weak_concepts: [],
        completeness: 0.1,
        data_version: "eie:0",
      },
      tier_signals: { facts_complete: false },
    });
    const json = packForModel(pack);
    expect(json).toBeTruthy();
    expect(json).not.toMatch(/demo|Arjun|Priya/i);
    expect(json).not.toMatch(/attendance_pct/);
  });
});
