import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Adding, replacing and removing the photo (D1). jsdom draws no images, so the
 * two drawing steps are stood in for; what is tested is the flow — pick,
 * crop, save; the camera offered only where there is one; remove.
 */
const st = vi.hoisted(() => ({ native: false, coarse: false, loadFails: false, rendered: [] as unknown[] }));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => st.native } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/cropSquare", async (orig) => ({
  ...(await orig<typeof import("@/lib/cropSquare")>()),
  loadImage: () =>
    st.loadFails
      ? Promise.reject(new Error("This photo can't be opened here. Choose a JPEG or PNG."))
      : Promise.resolve({ naturalWidth: 1200, naturalHeight: 800, src: "blob:photo" }),
  renderSquare: (_img: unknown, rect: unknown) => {
    st.rendered.push(rect);
    return Promise.resolve(new Blob(["jpeg"], { type: "image/jpeg" }));
  },
}));

const { ProfilePhotoEditor } = await import("./ProfilePhotoEditor");

const onSave = vi.fn();
const onRemove = vi.fn();
const draw = (hasPhoto = false) => render(<ProfilePhotoEditor hasPhoto={hasPhoto} onSave={onSave} onRemove={onRemove} />);
const pick = (testId: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { files: [new File(["x"], "me.jpg", { type: "image/jpeg" })] } });

beforeEach(() => {
  st.native = false;
  st.coarse = false;
  st.loadFails = false;
  st.rendered = [];
  onSave.mockReset().mockResolvedValue(undefined);
  onRemove.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (q: string) => ({ matches: q === "(pointer: coarse)" && st.coarse, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

describe("the profile photo (D1)", () => {
  it("offers the gallery everywhere, and the camera only where there is one", () => {
    const { unmount } = draw();
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take a photo" })).toBeNull();
    // The camera input asks for the front camera; the gallery input does not.
    expect(screen.getByTestId("photo-camera-input")).toHaveAttribute("capture", "user");
    expect(screen.getByTestId("photo-gallery-input")).not.toHaveAttribute("capture");
    unmount();
    st.native = true;
    const { unmount: u2 } = draw();
    expect(screen.getByRole("button", { name: "Take a photo" })).toBeInTheDocument();
    u2();
    st.native = false;
    st.coarse = true; // a phone's browser
    draw();
    expect(screen.getByRole("button", { name: "Take a photo" })).toBeInTheDocument();
  });

  it("crops what is picked to a square and saves that", async () => {
    draw();
    pick("photo-gallery-input");
    expect(await screen.findByTestId("crop-window")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use this photo" })); });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toBeInstanceOf(Blob);
    // The largest centred square of a 1200 × 800 photo.
    expect(st.rendered[0]).toEqual({ sx: 200, sy: 0, size: 800 });
    await waitFor(() => expect(screen.queryByTestId("crop-window")).toBeNull());
  });

  it("zooms in before saving", async () => {
    draw();
    pick("photo-gallery-input");
    await screen.findByTestId("crop-window");
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "2" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use this photo" })); });
    expect(st.rendered[0]).toEqual({ sx: 400, sy: 200, size: 400 });
  });

  it("says plainly when a photo cannot be opened, and saves nothing", async () => {
    st.loadFails = true;
    draw();
    pick("photo-gallery-input");
    expect(await screen.findByRole("alert")).toHaveTextContent("This photo can't be opened here. Choose a JPEG or PNG.");
    expect(screen.getByRole("button", { name: "Use this photo" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("removes the photo, and offers to change rather than add one while there is a photo", async () => {
    draw(true);
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove photo" })); });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: no photo, nothing to remove", () => {
    draw(false);
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
  });
});
