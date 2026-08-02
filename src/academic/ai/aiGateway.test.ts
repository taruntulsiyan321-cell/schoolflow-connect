import { describe, expect, it } from "vitest";
import {
  assertRegisteredCapability,
  getCapability,
  UnknownCapabilityError,
} from "./capabilityCatalog";
import { bindEnvelope, EnvelopeValidationError } from "./envelope";
import { planRoute, wouldCallModel, type KillSwitchState } from "./routerPolicy";
import {
  assertLinkedParentChild,
  assertStudentSelfOnly,
  AiPermissionError,
  resolveStudentTarget,
} from "./permissions";
import { resolveCoachCapability } from "./gatewayClient";
import { AeSnapshotL1Cache, buildL1CacheKey } from "./l1Cache";
import { mapIntentToCapability } from "./intentMapper";

const FLAGS_ON: KillSwitchState = {
  gatewayEnabled: true,
  deterministicEnabled: true,
  generativeEnabled: true,
};

describe("capability catalog", () => {
  it("rejects unknown feature", () => {
    expect(getCapability("student.made_up.thing")).toBeNull();
    expect(() => assertRegisteredCapability("student.made_up.thing")).toThrow(
      UnknownCapabilityError,
    );
  });

  it("registers deterministic student capabilities", () => {
    for (const id of [
      "student.attendance.query",
      "student.homework.due",
      "student.marks.summary",
      "student.timetable.today",
      "student.eie.mastery_summary",
      "student.performance.explain",
      "parent.child.summary",
      "parent.child.narrative",
    ]) {
      expect(getCapability(id)?.feature_id).toBe(id);
    }
  });
});

describe("envelope tenant binding", () => {
  it("injects tenant and actor from session", () => {
    const bound = bindEnvelope(
      { feature_id: "student.attendance.query", input: { text: "attendance?" } },
      {
        tenantId: "school-1",
        actor: { userId: "user-a", role: "student", studentId: "stu-a" },
        requestId: "req-1",
      },
    );
    expect(bound.tenant_id).toBe("school-1");
    expect(bound.actor.userId).toBe("user-a");
    expect(bound.request_id).toBe("req-1");
  });

  it("rejects client tenant override", () => {
    expect(() =>
      bindEnvelope(
        {
          feature_id: "student.attendance.query",
          tenant_id: "other-school",
        } as never,
        {
          tenantId: "school-1",
          actor: { userId: "user-a", role: "student", studentId: "stu-a" },
        },
      ),
    ).toThrow(EnvelopeValidationError);
  });

  it("rejects client actor override", () => {
    expect(() =>
      bindEnvelope(
        {
          feature_id: "student.attendance.query",
          actor: { userId: "user-b", role: "student" },
        } as never,
        {
          tenantId: "school-1",
          actor: { userId: "user-a", role: "student", studentId: "stu-a" },
        },
      ),
    ).toThrow(EnvelopeValidationError);
  });
});

describe("router policy", () => {
  it("never calls model for attendance", () => {
    expect(wouldCallModel("student.attendance.query", FLAGS_ON)).toBe(false);
    const plan = planRoute("student.attendance.query", FLAGS_ON);
    expect("rejected" in plan).toBe(false);
    if (!("rejected" in plan)) {
      expect(plan.may_call_model).toBe(false);
      expect(plan.decision_if_ready).toBe("answered_deterministic");
    }
  });

  it("never calls model for homework/marks/timetable/eie", () => {
    for (const id of [
      "student.homework.due",
      "student.marks.summary",
      "student.timetable.today",
      "student.eie.mastery_summary",
      "parent.child.summary",
      "parent.child.narrative",
    ]) {
      expect(wouldCallModel(id, FLAGS_ON)).toBe(false);
    }
  });

  it("kill switch: generative fails safe; deterministic still works", () => {
    const generativeOff: KillSwitchState = {
      ...FLAGS_ON,
      generativeEnabled: false,
    };
    const att = planRoute("student.attendance.query", generativeOff);
    expect("rejected" in att).toBe(false);
    if (!("rejected" in att)) {
      expect(att.may_call_model).toBe(false);
      expect(att.decision_if_ready).toBe("answered_deterministic");
    }

    const explain = planRoute("student.performance.explain", generativeOff);
    expect("rejected" in explain).toBe(false);
    if (!("rejected" in explain)) {
      expect(explain.may_call_model).toBe(false);
      expect(explain.decision_if_ready).toBe("answered_facts_only");
    }
  });

  it("gateway kill switch rejects everything", () => {
    const plan = planRoute("student.attendance.query", {
      ...FLAGS_ON,
      gatewayEnabled: false,
    });
    expect("rejected" in plan && plan.rejected).toBe(true);
    if ("rejected" in plan) {
      expect(plan.decision).toBe("kill_switch");
    }
  });

  it("optional explain may call model when generative on", () => {
    expect(wouldCallModel("student.performance.explain", FLAGS_ON)).toBe(true);
  });
});

describe("auth relationship rules", () => {
  it("student A cannot target student B", () => {
    expect(() =>
      resolveStudentTarget(
        { userId: "ua", role: "student", studentId: "stu-a" },
        "stu-b",
      ),
    ).toThrow(AiPermissionError);
  });

  it("student defaults to self", () => {
    expect(
      resolveStudentTarget({ userId: "ua", role: "student", studentId: "stu-a" }, null),
    ).toBe("stu-a");
  });

  it("parent only linked child", () => {
    expect(() =>
      assertLinkedParentChild(
        { userId: "p1", role: "parent" },
        "stu-b",
        ["stu-a"],
      ),
    ).toThrow(AiPermissionError);

    expect(() =>
      assertLinkedParentChild(
        { userId: "p1", role: "parent" },
        "stu-a",
        ["stu-a"],
      ),
    ).not.toThrow();
  });

  it("assertStudentSelfOnly blocks cross-student", () => {
    expect(() =>
      assertStudentSelfOnly({ userId: "ua", role: "student", studentId: "stu-a" }, "stu-b"),
    ).toThrow(AiPermissionError);
  });
});

describe("intent mapping / golden routes", () => {
  it("maps attendance / homework / marks / timetable / mastery phrases", () => {
    expect(mapIntentToCapability("What is my attendance this month?")?.feature_id).toBe(
      "student.attendance.query",
    );
    expect(mapIntentToCapability("Which homework is due tomorrow?")?.feature_id).toBe(
      "student.homework.due",
    );
    expect(mapIntentToCapability("Show my marks in Science")?.feature_id).toBe(
      "student.marks.summary",
    );
    expect(mapIntentToCapability("What is today's timetable?")?.feature_id).toBe(
      "student.timetable.today",
    );
    expect(mapIntentToCapability("What should I revise? Show mastery")?.feature_id).toBe(
      "student.eie.mastery_summary",
    );
    expect(mapIntentToCapability("How am I doing — explain my performance")?.feature_id).toBe(
      "student.performance.explain",
    );
  });

  it("unsupported free text does not invent a capability", () => {
    const r = resolveCoachCapability({ text: "Write me a love poem about calculus" });
    expect("unsupported" in r).toBe(true);
  });
});

describe("L1 cache", () => {
  it("keys by tenant/student/capability/data_version", () => {
    const key = buildL1CacheKey({
      tenantId: "t1",
      studentId: "s1",
      capability: "student.attendance.query",
      dataVersion: "att:s1:3",
    });
    expect(key).toContain("t1");
    expect(key).toContain("s1");
    expect(key).toContain("student.attendance.query");

    const cache = new AeSnapshotL1Cache(60_000);
    cache.set(key, { attendance_pct: 0 });
    expect(cache.get<{ attendance_pct: number }>(key)?.attendance_pct).toBe(0);
    // Honest empty — never invent demo numbers in cache seed
    expect(cache.get<{ attendance_pct: number }>(key)?.attendance_pct).not.toBe(1382);
  });
});

describe("no demo / fake numbers in mapper", () => {
  it("does not embed demo XP or fake names", () => {
    const src = mapIntentToCapability.toString() + resolveCoachCapability.toString();
    expect(src).not.toMatch(/Arjun|Priya Nair|1382|Level 14/i);
  });
});
