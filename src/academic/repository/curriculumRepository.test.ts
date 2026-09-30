/**
 * A topic is one topic whatever its case (20261126000000). addChapterTopic
 * reuses "Share Capital" when a teacher adds "share capital", and only inserts
 * a name the chapter does not have.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { addChapterTopic, sameTopicName } = await import("./curriculumRepository");

type Row = { id: string; name: string };

/** A client with one chapter's topics; `lists` answers each successive read. */
function fakeClient(lists: Row[][], insertResult: { data: Row | null; error: { code: string; message: string } | null }) {
  const inserted: unknown[] = [];
  let read = 0;
  const client = {
    from: (table: string) => {
      if (table !== "topics") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: lists[Math.min(read++, lists.length - 1)], error: null }),
          }),
        }),
        insert: (row: unknown) => {
          inserted.push(row);
          return { select: () => ({ single: async () => insertResult }) };
        },
      };
    },
  };
  return { client, inserted, reads: () => read };
}

const ctx = (client: unknown) => ({ client, userId: "teacher-1" }) as never;

describe("addChapterTopic — one topic per name, whatever its case", () => {
  it("reuses the chapter's topic when the name differs only in case or space", async () => {
    const f = fakeClient([[{ id: "t1", name: "Share Capital" }]], { data: null, error: null });
    const got = await addChapterTopic(ctx(f.client), "ch-1", "  share capital ");
    expect(got).toEqual({ id: "t1", name: "Share Capital" });
    expect(f.inserted).toHaveLength(0);
  });

  it("CONTROL: a name the chapter does not have is inserted, trimmed", async () => {
    const f = fakeClient([[{ id: "t1", name: "Share Capital" }]], { data: { id: "t2", name: "Securities Premium" }, error: null });
    const got = await addChapterTopic(ctx(f.client), "ch-1", " Securities Premium ");
    expect(got).toEqual({ id: "t2", name: "Securities Premium" });
    expect(f.inserted).toEqual([{ chapter_id: "ch-1", name: "Securities Premium", created_by: "teacher-1" }]);
  });

  it("when another teacher adds it first, the refusal becomes their topic", async () => {
    const f = fakeClient(
      [[], [{ id: "t9", name: "Share Capital" }]],
      { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"topics_chapter_lower_name_key\"" } },
    );
    const got = await addChapterTopic(ctx(f.client), "ch-1", "share capital");
    expect(got).toEqual({ id: "t9", name: "Share Capital" });
    expect(f.reads()).toBe(2);
  });

  it("names the same topic only when they match case and space aside", () => {
    expect(sameTopicName("Share Capital", " share capital")).toBe(true);
    expect(sameTopicName("Share Capital", "Share Capitals")).toBe(false);
  });
});
