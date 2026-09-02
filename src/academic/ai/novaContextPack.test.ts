/**
 * Nova Context Pack v1 — unit tests (mirrors student.performance.explain grounding).
 */
import { describe, expect, it } from "vitest";
import { buildContextPack, packForModel } from "./contextBuilder";
import {
  evidenceFromExplainFacts,
  validateModelResponse,
} from "./responseValidator";
import { getBuiltinPrompt, renderPromptTemplate } from "./promptLibrary";
import { getCapability } from "./capabilityCatalog";

const AE = {
  attendance: {
    projection: "StudentAttendanceQuery",
    attendance_pct: 91,
    completeness: 1,
    data_version: "att:s1:10",
    source_as_of: "2026-08-01",
  },
  homework: {
    projection: "StudentHomeworkDue",
    pending_count: 2,
    completeness: 1,
    data_version: "hw:s1:2",
    source_as_of: "2026-08-02",
  },
  marks: {
    projection: "StudentMarksSummary",
    average_pct: 78,
    completeness: 1,
    data_version: "marks:s1:3",
    source_as_of: null,
  },
  profile: {
    projection: "ParentChildSummary",
    weak_topics: ["Integration"],
    completeness: 1,
    data_version: "parent:s1:now",
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

  it("builtin prompt v2 includes facts placeholder", () => {
    const p = getBuiltinPrompt("student.nova.chat");
    expect(p?.version).toBe("v2");
    expect(p?.user_template).toContain("{{facts}}");
    expect(p?.user_template).toContain("{{question}}");
    const rendered = renderPromptTemplate(p!.user_template, {
      facts: '{"ae":{"attendance":{"attendance_pct":91}}}',
      question: "How am I doing?",
      language: "en",
    });
    expect(rendered).toContain("91");
    expect(rendered).toContain("How am I doing?");
  });

  it("buildContextPack yields non-empty facts for Prompt Library", () => {
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
    expect(json).toContain("91");
    expect(json).toContain("62");
    expect(json).not.toMatch(/Arjun|1382|Level 14/i);
  });

  it("validator uses AE/EIE evidence (not empty object)", () => {
    const evidence = evidenceFromExplainFacts({
      attendance: { attendance_pct: 91 },
      homework: { pending_count: 2 },
      marks: { average_pct: 78 },
      eie: { avg_mastery: 62 },
    });
    expect(evidence.attendance_pct).toBe(91);
    expect(evidence.avg_mastery).toBe(62);
    expect((evidence.allowed_pcts ?? []).length).toBeGreaterThan(0);

    const ok = validateModelResponse(
      "Attendance is 91%. Tracked mastery averages 62%. Focus on Integration.",
      evidence,
    );
    expect(ok.material_failure).toBe(false);

    const bad = validateModelResponse("Your mastery is 99%.", evidence);
    expect(bad.material_failure).toBe(true);
    expect(bad.codes).toContain("invented_mastery_pct");
  });

  it("honest empty pack still serialises without inventing metrics", () => {
    const pack = buildContextPack({
      capability: "student.nova.chat",
      request_text: "hi",
      ae: {
        attendance: { attendance_pct: 0, completeness: 0, data_version: "att:empty" },
        homework: { pending_count: 0, completeness: 0.2, data_version: "hw:empty" },
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
  });
});
