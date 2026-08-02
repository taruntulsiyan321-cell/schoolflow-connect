import type { QueryClient } from "@tanstack/react-query";
import type { AcademicDomain } from "./bus";

export const academicQueryKeys = {
  root: ["academic"] as const,
  attendance: (schoolId?: string | null) => ["academic", "attendance", schoolId ?? ""] as const,
  homework: (schoolId?: string | null) => ["academic", "homework", schoolId ?? ""] as const,
  marks: (schoolId?: string | null) => ["academic", "marks", schoolId ?? ""] as const,
  examination: (schoolId?: string | null) => ["academic", "examination", schoolId ?? ""] as const,
  test: (schoolId?: string | null) => ["academic", "test", schoolId ?? ""] as const,
  profile: (schoolId?: string | null) => ["academic", "profile", schoolId ?? ""] as const,
  xp: (schoolId?: string | null, userId?: string | null) =>
    ["academic", "xp", schoolId ?? "", userId ?? ""] as const,
  battle: (schoolId?: string | null) => ["academic", "battle", schoolId ?? ""] as const,
  badges: (schoolId?: string | null, userId?: string | null) =>
    ["academic", "badges", schoolId ?? "", userId ?? ""] as const,
  doubt: (schoolId?: string | null) => ["academic", "doubt", schoolId ?? ""] as const,
};

const DOMAIN_PREFIX: Record<Exclude<AcademicDomain, "all">, string> = {
  attendance: "attendance",
  homework: "homework",
  marks: "marks",
  examination: "examination",
  test: "test",
  profile: "profile",
  xp: "xp",
  battle: "battle",
  achievements: "badges",
  doubt: "doubt",
};

export async function invalidateAcademicQueries(
  queryClient: QueryClient,
  domains: AcademicDomain[],
): Promise<void> {
  if (domains.includes("all") || domains.length === 0) {
    await queryClient.invalidateQueries({ queryKey: academicQueryKeys.root });
    return;
  }
  await Promise.all(
    domains.map((d) => {
      if (d === "all") return queryClient.invalidateQueries({ queryKey: academicQueryKeys.root });
      return queryClient.invalidateQueries({
        queryKey: ["academic", DOMAIN_PREFIX[d]],
      });
    }),
  );
}
