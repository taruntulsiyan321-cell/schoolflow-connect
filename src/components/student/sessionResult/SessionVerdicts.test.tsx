import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionVerdicts } from "./SessionVerdicts";

/**
 * A recovery round or revision check the engine refused to count says so on
 * the result screen, and stays said. It used to be a toast that vanished as
 * this screen opened (measured on production, 2026-10-14).
 */

const show = (notCounted: Parameters<typeof SessionVerdicts>[0]["notCounted"]) =>
  render(<MemoryRouter><SessionVerdicts recovery={null} revision={null} notCounted={notCounted} /></MemoryRouter>);

describe("a session the engine did not count", () => {
  it("a revision check: says it was not counted, why, and where to take it again", () => {
    show({ kind: "revision", reason: "a revision check needs 8 unseen question(s) from this chapter; that sitting answered 1" });
    const card = screen.getByTestId("verdict-not-counted");
    expect(card).toHaveTextContent("This revision check was not counted");
    expect(card).toHaveTextContent("A revision check needs 8 unseen question(s) from this chapter; that sitting answered 1. Your practice is saved");
    expect(screen.getByRole("link", { name: "Take the check again from Revision" })).toHaveAttribute("href", "/student/revision");
  });

  it("a recovery round: the same, pointing at Recovery", () => {
    show({ kind: "recovery", reason: "this round is already closed" });
    expect(screen.getByTestId("verdict-not-counted")).toHaveTextContent("This recovery round was not counted");
    expect(screen.getByRole("link", { name: "Start the round again from Recovery" })).toHaveAttribute("href", "/student/recovery");
  });

  it("CONTROL: a session that counted shows no such card", () => {
    show(null);
    expect(screen.queryByTestId("verdict-not-counted")).toBeNull();
  });
});
