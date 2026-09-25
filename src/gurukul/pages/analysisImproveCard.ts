/**
 * Analysis — the "What should I improve?" card's two lines.
 *
 * The headline is SUBJECTS and the line under it is TOPICS, and a subject can
 * be weak while no topic in it has been flagged yet. The card said "No weak
 * topics flagged yet" under three weak subjects (CUET audit account, live
 * 2026-09-25), which read as the card contradicting itself.
 */
import { pluralise } from "@/lib/plural";

/** "A", "A & B", "A, B & C" — "A & B & C" read as a stammer. */
export function improveHeadline(weakSubjects: string[], hasSubjects: boolean): string {
  if (weakSubjects.length === 0) return hasSubjects ? "Keep building consistency" : "Start practising to see insights";
  if (weakSubjects.length === 1) return weakSubjects[0];
  return `${weakSubjects.slice(0, -1).join(", ")} & ${weakSubjects[weakSubjects.length - 1]}`;
}

export function improveSubline(weakTopics: number, weakSubjects: number): string {
  // "1 topic need attention" — the noun was pluralised and the verb was not.
  if (weakTopics > 0) return `${pluralise(weakTopics, "topic")} ${weakTopics === 1 ? "needs" : "need"} attention`;
  if (weakSubjects > 0) return "No single topic stands out yet";
  return "No weak topics flagged yet";
}
