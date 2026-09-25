/**
 * A migration is applied when the ledger names IT — not a neighbour that shares
 * its timestamp. Matching on the stamp hid five 2026-09-23 migrations and three
 * 2026-09-03 ones behind their neighbours, and db:check-migrations passed.
 */
import { describe, expect, it } from "vitest";
import {
  ledgerRowsWithoutFile,
  rollbackCovers,
  sharedStamps,
  unappliedFiles,
} from "../../scripts/lib/migration-ledger.mjs";

const FILES = [
  "20261058000000_a_variant_mistake_belongs_to_the_question_it_came_from.sql",
  "20261058000000_the_chapter_list_reads_each_answer_once.sql",
  "20261059000000_a_trend_is_the_last_three_against_the_three_before.sql",
];

describe("which files the ledger has applied", () => {
  it("a file whose neighbour on the same timestamp was applied is still pending", () => {
    const ledger = [
      "20261058000000_the_chapter_list_reads_each_answer_once",
      "20261059000000_a_trend_is_the_last_three_against_the_three_before",
    ];
    expect(unappliedFiles(FILES, ledger)).toEqual([
      "20261058000000_a_variant_mistake_belongs_to_the_question_it_came_from.sql",
    ]);
  });

  it("CONTROL: with every name in the ledger, nothing is pending", () => {
    expect(unappliedFiles(FILES, FILES.map((f) => f.replace(/\.sql$/, "")))).toEqual([]);
  });

  it("a ledger row whose file was renamed has no file", () => {
    const ledger = ["20261072000000_recovery_admits_upload_mistakes", "20261059000000_a_trend_is_the_last_three_against_the_three_before"];
    expect(ledgerRowsWithoutFile(FILES, ledger)).toEqual(["20261072000000_recovery_admits_upload_mistakes"]);
  });
});

describe("which migration a rollback reverses", () => {
  const shared = sharedStamps(FILES);

  it("knows which timestamps two files share", () => {
    expect([...shared]).toEqual(["20261058000000"]);
  });

  it("a rollback named for one of two same-stamp migrations covers only that one", () => {
    const rb = [{ file: "20261058000000_the_chapter_list_reads_each_answer_once.rollback.sql", text: "" }];
    expect(rollbackCovers("20261058000000_the_chapter_list_reads_each_answer_once", rb, shared)).toBe(true);
    expect(rollbackCovers("20261058000000_a_variant_mistake_belongs_to_the_question_it_came_from", rb, shared)).toBe(false);
  });

  it("a legacy rollback that names a bare timestamp covers the one migration carrying it", () => {
    const rb = [{ file: "20260828110000_chunk67_batch1_down.sql", text: "-- reverses 20261059000000 and others" }];
    expect(rollbackCovers("20261059000000_a_trend_is_the_last_three_against_the_three_before", rb, shared)).toBe(true);
    expect(rollbackCovers("20261058000000_the_chapter_list_reads_each_answer_once",
      [{ file: "x.sql", text: "20261058000000" }], shared)).toBe(false);
  });
});
