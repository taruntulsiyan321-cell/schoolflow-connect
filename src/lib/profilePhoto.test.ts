import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving and removing a photo (D1): the order matters. A new file is uploaded,
 * then named in the profile, then the old one goes — so the profile never
 * names a file that is not there, and a refused save leaves no stray file.
 */
const calls: string[] = [];
const st = vi.hoisted(() => ({
  uploadError: null as unknown,
  rpcError: null as unknown,
  signed: "https://signed.example/photo" as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => { calls.push(`upload ${bucket} ${path}`); return Promise.resolve({ error: st.uploadError }); },
        remove: (paths: string[]) => { calls.push(`remove ${paths.join(",")}`); return Promise.resolve({ error: null }); },
        createSignedUrl: (path: string) => Promise.resolve(st.signed ? { data: { signedUrl: st.signed }, error: null } : { data: null, error: { message: "gone" } }),
      }),
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc ${name} ${JSON.stringify(args)}`);
      return Promise.resolve({ data: null, error: st.rpcError });
    },
  },
}));

const { newPhotoPath, removeProfilePhoto, saveProfilePhoto, signPhoto, PROFILE_PHOTO_BUCKET } = await import("./profilePhoto");

const UID = "6f1d1d2a-1111-4c2b-9a3e-000000000001";
const blob = new Blob(["x"], { type: "image/jpeg" });

beforeEach(() => {
  calls.length = 0;
  st.uploadError = null;
  st.rpcError = null;
  st.signed = "https://signed.example/photo";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("a profile photo (D1)", () => {
  it("names a file the database will accept: the student's own folder, a number, .jpg", () => {
    const migration = readFileSync("supabase/migrations/20261156000000_a_profile_photo.sql", "utf8");
    // The CHECK and the function both hold the key to this shape.
    expect(migration).toContain("photo_url ~ ('^' || id::text || '/[0-9]+\\.jpg$')");
    const path = newPhotoPath(UID, 1_700_000_000_000);
    expect(path).toBe(`${UID}/1700000000000.jpg`);
    expect(new RegExp(`^${UID}/[0-9]+\\.jpg$`).test(path)).toBe(true);
  });

  it("uploads, then names it, then removes the photo it replaces", async () => {
    const path = await saveProfilePhoto(UID, blob, `${UID}/1.jpg`);
    expect(calls).toEqual([
      `upload ${PROFILE_PHOTO_BUCKET} ${path}`,
      `rpc rpc_set_profile_photo {"_path":"${path}"}`,
      `remove ${UID}/1.jpg`,
    ]);
  });

  it("a refused save removes the new file and says the server's reason", async () => {
    st.rpcError = { message: "photo_not_uploaded", details: "The photo did not finish uploading. Try again." };
    await expect(saveProfilePhoto(UID, blob, `${UID}/1.jpg`)).rejects.toThrow("The photo did not finish uploading. Try again.");
    // The new file is gone, and the old one — still the profile's — is kept.
    expect(calls[2]).toMatch(new RegExp(`^remove ${UID}/[0-9]+\\.jpg$`));
    expect(calls).not.toContain(`remove ${UID}/1.jpg`);
  });

  it("a failed upload names nothing", async () => {
    st.uploadError = { message: "The object exceeded the maximum allowed size" };
    await expect(saveProfilePhoto(UID, blob, null)).rejects.toThrow("The object exceeded the maximum allowed size");
    expect(calls.some((c) => c.startsWith("rpc"))).toBe(false);
  });

  it("removing clears the profile first, by leaving the path out, then the file", async () => {
    await removeProfilePhoto(`${UID}/2.jpg`);
    expect(calls).toEqual(["rpc rpc_set_profile_photo {}", `remove ${UID}/2.jpg`]);
  });

  it("a photo that cannot be signed is an error, not a broken link", async () => {
    st.signed = null;
    await expect(signPhoto(`${UID}/2.jpg`)).rejects.toThrow();
  });
});
