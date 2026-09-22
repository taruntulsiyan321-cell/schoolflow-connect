/**
 * A list the Practice page reads: still being read, could not be read, or read.
 *
 * Measured 2026-09-22: every list on the page held only its items, so a list
 * still being read rendered its empty sentence. Every tap on a subject said
 * "No chapters in the bank for this subject yet." for the second or so the
 * chapter list took; the subject list said "No subjects in the question bank
 * yet", and the hub "No practice in the last 7 days", while they loaded. A
 * failed read said the same. Loading and failed are states of their own.
 */
export type ListState<T> =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; items: T[] };

export const LOADING_LIST: ListState<never> = { status: "loading" };
/** Read, and empty: there is nothing to read (e.g. an account with no class). */
export const EMPTY_LIST: ListState<never> = { status: "ready", items: [] };

/** The items of a list that has been read; nothing otherwise. */
export function listItems<T>(list: ListState<T>): T[] {
  return list.status === "ready" ? list.items : [];
}
