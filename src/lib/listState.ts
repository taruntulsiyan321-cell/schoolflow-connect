/**
 * A list read from the server: still being read, could not be read, or read.
 *
 * Measured 2026-09-22: lists across the student panel held only their items,
 * so a list still being read rendered its empty sentence, and so did a list
 * whose read failed. Practice said "No chapters in the bank for this subject
 * yet." for the second or so every chapter list took; Revision said "No
 * revision checks taken yet" while its history loaded; Analysis said "Nothing
 * due for revision today" when the schedule could not be read at all. Loading
 * and failed are states of their own.
 */
export type ListState<T> =
  | { status: "loading" }
  | { status: "failed"; message?: string }
  | { status: "ready"; items: T[] };

export const LOADING_LIST: ListState<never> = { status: "loading" };
/** Read, and empty: there is nothing to read (e.g. an account with no class). */
export const EMPTY_LIST: ListState<never> = { status: "ready", items: [] };

/** The items of a list that has been read; nothing otherwise. */
export function listItems<T>(list: ListState<T>): T[] {
  return list.status === "ready" ? list.items : [];
}
