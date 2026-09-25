/**
 * A render error — a page whose file failed to load, or a bug — must not leave
 * a blank page (measured 2026-09-25 on www.gurukul.study: one failed file, a
 * white screen with nothing to press).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppErrorBoundary, isChunkLoadError } from "./AppErrorBoundary";

function Throws({ error }: { error: Error }): never {
  throw error;
}

describe("the app does not go blank", () => {
  afterEach(() => {
    delete window.__gurukulReloadOnce;
    vi.restoreAllMocks();
  });

  it("a page whose file failed to load asks the boot guard for one reload, and says so", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reloadOnce = vi.fn(() => false);
    window.__gurukulReloadOnce = reloadOnce;
    render(
      <AppErrorBoundary>
        <Throws error={new TypeError("Failed to fetch dynamically imported module: https://x/assets/Recovery-abc.js")} />
      </AppErrorBoundary>,
    );
    expect(reloadOnce).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Part of Gurukul couldn’t load");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("any other render error is said plainly, and does not reload on its own", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reloadOnce = vi.fn(() => true);
    window.__gurukulReloadOnce = reloadOnce;
    render(
      <AppErrorBoundary>
        <Throws error={new Error("x is undefined")} />
      </AppErrorBoundary>,
    );
    expect(reloadOnce).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("CONTROL: with nothing wrong, the app renders and no alert is drawn", () => {
    render(
      <AppErrorBoundary>
        <p>the app</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("the app")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("knows a failed file from other errors, in each browser's wording", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /a.js"))).toBe(true); // Chrome
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true); // Safari
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: /a.js"))).toBe(true); // Firefox
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
  });
});
