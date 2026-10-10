import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

/**
 * One store for the photo (D1): read once per account, and a photo saved in
 * one place is the photo in every place at once — the top bar must not keep
 * the old picture after Profile saves a new one.
 */
const st = vi.hoisted(() => ({ path: null as string | null, reads: 0, saved: [] as string[], removed: 0, failRead: false }));

vi.mock("@/lib/profilePhoto", () => ({
  readPhotoPath: () => {
    st.reads += 1;
    return st.failRead ? Promise.reject(new Error("offline")) : Promise.resolve(st.path);
  },
  signPhoto: (p: string) => Promise.resolve(`https://signed.example/${p}`),
  saveProfilePhoto: (uid: string) => {
    const p = `${uid}/${st.saved.length + 2}.jpg`;
    st.saved.push(p);
    return Promise.resolve(p);
  },
  removeProfilePhoto: () => {
    st.removed += 1;
    return Promise.resolve();
  },
}));

const { useProfilePhoto, resetProfilePhotoStore } = await import("./useProfilePhoto");

let api: ReturnType<typeof useProfilePhoto> | null = null;
function Shown({ id, userId, expose = false }: { id: string; userId: string | null; expose?: boolean }) {
  const photo = useProfilePhoto(userId);
  if (expose) api = photo;
  return <span data-testid={id}>{photo.url ?? "initials"}</span>;
}

beforeEach(() => {
  resetProfilePhotoStore();
  st.path = null;
  st.reads = 0;
  st.saved = [];
  st.removed = 0;
  st.failRead = false;
  api = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the photo, wherever it is shown (D1)", () => {
  it("is read once for every place that shows it, and signed", async () => {
    st.path = "u1/1.jpg";
    render(<><Shown id="top" userId="u1" /><Shown id="menu" userId="u1" /><Shown id="card" userId="u1" /></>);
    await waitFor(() => expect(screen.getByTestId("top")).toHaveTextContent("https://signed.example/u1/1.jpg"));
    expect(screen.getByTestId("card")).toHaveTextContent("https://signed.example/u1/1.jpg");
    expect(st.reads).toBe(1);
  });

  it("a photo saved in one place is shown in every place, and removing it brings the initials back everywhere", async () => {
    render(<><Shown id="top" userId="u1" /><Shown id="card" userId="u1" expose /></>);
    await waitFor(() => expect(api).not.toBeNull());
    expect(screen.getByTestId("top")).toHaveTextContent("initials");
    await act(async () => { await api!.save(new Blob(["x"])); });
    expect(screen.getByTestId("top")).toHaveTextContent("https://signed.example/u1/2.jpg");
    expect(api!.hasPhoto).toBe(true);
    await act(async () => { await api!.remove(); });
    expect(st.removed).toBe(1);
    expect(screen.getByTestId("top")).toHaveTextContent("initials");
    expect(screen.getByTestId("card")).toHaveTextContent("initials");
  });

  it("an account that cannot read its photo shows the initials", async () => {
    st.failRead = true;
    render(<Shown id="top" userId="u1" />);
    await waitFor(() => expect(st.reads).toBe(1));
    expect(screen.getByTestId("top")).toHaveTextContent("initials");
  });

  it("another account never sees the last one's photo — not for a single render", async () => {
    // Every render is recorded: a leak lasting one frame, before the new
    // account's read begins, is still a leak.
    const seen: Array<[string | null, string | null]> = [];
    function Recorded({ userId }: { userId: string | null }) {
      const photo = useProfilePhoto(userId);
      seen.push([userId, photo.url]);
      return <span data-testid="top">{photo.url ?? "initials"}</span>;
    }
    st.path = "u1/1.jpg";
    const { rerender } = render(<Recorded userId="u1" />);
    await waitFor(() => expect(screen.getByTestId("top")).toHaveTextContent("u1/1.jpg"));
    st.path = null;
    rerender(<Recorded userId="u2" />);
    await waitFor(() => expect(st.reads).toBe(2));
    expect(seen.filter(([u, url]) => u === "u2" && url !== null)).toEqual([]);
    // CONTROL: u1's own renders did show it.
    expect(seen.some(([u, url]) => u === "u1" && url?.includes("u1/1.jpg"))).toBe(true);
  });
});
