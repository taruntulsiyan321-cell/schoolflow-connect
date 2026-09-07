import { describe, expect, it } from "vitest";
import {
  extractAcademicStoragePath,
  toDurableAcademicFileRef,
} from "@/academic/storage/academicFileUpload";

/**
 * `uploadAcademicFile` stores a DURABLE REF rather than a public URL, so that a
 * row does not bake in the assumption that `academic-files` is a public bucket
 * (KNOWN_ISSUES 7). Everything then depends on reading three shapes back:
 *
 *   - the durable ref new uploads write
 *   - the bare object path `learning_resources.storage_path` holds
 *   - the legacy public URL already sitting in `homework.attachments`
 *
 * ...and on NOT mistaking a teacher's link to YouTube or NCERT for one of ours,
 * which would try to sign it and hand back a dead URL.
 *
 * These are pure functions, so they are tested here rather than through a
 * browser; the signing itself is asserted against the live bucket in
 * `e2e-evidence/known-issues.spec.ts`, because only a real caller can prove the
 * storage policy admits it.
 */

const UID = "d1000002-0001-4000-8000-000000000001";
const OBJ = `${UID}/1788000000000-notes.pdf`;

describe("toDurableAcademicFileRef", () => {
  it("prefixes a bare object path with the bucket", () => {
    expect(toDurableAcademicFileRef(OBJ)).toBe(`academic-files/${OBJ}`);
  });

  it("is idempotent — a ref that is already prefixed is unchanged", () => {
    const once = toDurableAcademicFileRef(OBJ);
    expect(toDurableAcademicFileRef(once)).toBe(once);
  });

  it("strips a leading slash rather than producing a double one", () => {
    expect(toDurableAcademicFileRef(`/${OBJ}`)).toBe(`academic-files/${OBJ}`);
  });
});

describe("extractAcademicStoragePath", () => {
  it("reads back a durable ref (the shape new uploads write)", () => {
    expect(extractAcademicStoragePath(`academic-files/${OBJ}`)).toBe(OBJ);
  });

  it("reads a bare object path — learning_resources.storage_path", () => {
    expect(extractAcademicStoragePath(OBJ)).toBe(OBJ);
  });

  it("reads a legacy PUBLIC url — what homework.attachments already holds", () => {
    const legacy =
      `https://psqxykzqfvxgsvkmgurn.supabase.co/storage/v1/object/public/academic-files/${OBJ}`;
    expect(extractAcademicStoragePath(legacy)).toBe(OBJ);
  });

  it("reads a signed url of ours, ignoring its query string", () => {
    const signed =
      `https://psqxykzqfvxgsvkmgurn.supabase.co/storage/v1/object/sign/academic-files/${OBJ}?token=abc.def`;
    expect(extractAcademicStoragePath(signed)).toBe(OBJ);
  });

  it("percent-decodes a name that was encoded in the url", () => {
    const encoded =
      `https://x.supabase.co/storage/v1/object/public/academic-files/${UID}/my%20notes.pdf`;
    expect(extractAcademicStoragePath(encoded)).toBe(`${UID}/my notes.pdf`);
  });

  it("returns null for an EXTERNAL link — the one that must pass through", () => {
    // A teacher pasting a YouTube or NCERT link is the common case; signing it
    // would replace a working link with a dead one.
    expect(extractAcademicStoragePath("https://www.youtube.com/watch?v=abc")).toBeNull();
    expect(extractAcademicStoragePath("https://ncert.nic.in/textbook.php")).toBeNull();
  });

  it("returns null for another bucket's url", () => {
    expect(
      extractAcademicStoragePath(
        "https://x.supabase.co/storage/v1/object/public/chat-attachments/a/b.png",
      ),
    ).toBeNull();
  });

  it("returns null for empty and for a bare filename with no uid folder", () => {
    expect(extractAcademicStoragePath("")).toBeNull();
    expect(extractAcademicStoragePath("   ")).toBeNull();
    expect(extractAcademicStoragePath("notes.pdf")).toBeNull();
  });

  it("round-trips: ref -> path -> ref", () => {
    const ref = toDurableAcademicFileRef(OBJ);
    const path = extractAcademicStoragePath(ref);
    expect(path).not.toBeNull();
    expect(toDurableAcademicFileRef(path as string)).toBe(ref);
  });
});
