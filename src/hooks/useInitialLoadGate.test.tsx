import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen, act } from "@testing-library/react";
import { useInitialLoadGate } from "./useInitialLoadGate";

/**
 * The gate deliberately suppresses the spinner on a refetch of the SAME
 * subject, so a live-event bump updates data in place. These tests pin the
 * distinction it could not previously make: a change of subject must show
 * loading again, because the data on screen belongs to someone else.
 */

function Panel({ subjectId, tick }: { subjectId: string; tick: number }) {
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate([subjectId]);
  const [loading, setLoading] = useState(true);

  // Stand-in for the effect body every caller runs.
  const start = () => beginLoading(setLoading);
  const finish = () => endLoading(setLoading);

  return (
    <div>
      <span data-testid="subject">{subjectId}</span>
      <span data-testid="tick">{tick}</span>
      <span data-testid="shows-loading">{showLoading(loading) ? "yes" : "no"}</span>
      <button onClick={start}>start</button>
      <button onClick={finish}>finish</button>
    </div>
  );
}

const shows = () => screen.getByTestId("shows-loading").textContent;

describe("useInitialLoadGate", () => {
  it("shows loading on the genuine first fetch", () => {
    render(<Panel subjectId="a" tick={0} />);
    act(() => screen.getByText("start").click());
    expect(shows()).toBe("yes");
  });

  it("does NOT show loading when the same subject refetches", () => {
    const { rerender } = render(<Panel subjectId="a" tick={0} />);
    act(() => screen.getByText("start").click());
    act(() => screen.getByText("finish").click());
    expect(shows()).toBe("no");

    // A live-event bump: same subject, new tick. Data must stay in place.
    rerender(<Panel subjectId="a" tick={1} />);
    act(() => screen.getByText("start").click());
    expect(shows()).toBe("no");
  });

  it("DOES show loading again when the subject changes", () => {
    const { rerender } = render(<Panel subjectId="a" tick={0} />);
    act(() => screen.getByText("start").click());
    act(() => screen.getByText("finish").click());
    expect(shows()).toBe("no");

    // Switching child / class / student is not a refresh — the rendered data
    // belongs to the previous subject and must not be presented as this one's.
    rerender(<Panel subjectId="b" tick={0} />);
    act(() => screen.getByText("start").click());
    expect(shows()).toBe("yes");
  });

  it("resets again on every subsequent switch", () => {
    const { rerender } = render(<Panel subjectId="a" tick={0} />);
    for (const id of ["b", "c", "d"]) {
      act(() => screen.getByText("start").click());
      act(() => screen.getByText("finish").click());
      expect(shows()).toBe("no");
      rerender(<Panel subjectId={id} tick={0} />);
      act(() => screen.getByText("start").click());
      expect(shows(), `switch to ${id}`).toBe("yes");
    }
  });

  it("keeps its original behaviour when no key is supplied", () => {
    function Unkeyed({ tick }: { tick: number }) {
      const { beginLoading, endLoading, showLoading } = useInitialLoadGate();
      const [loading, setLoading] = useState(true);
      return (
        <div>
          <span data-testid="tick">{tick}</span>
          <span data-testid="shows-loading">{showLoading(loading) ? "yes" : "no"}</span>
          <button onClick={() => beginLoading(setLoading)}>start</button>
          <button onClick={() => endLoading(setLoading)}>finish</button>
        </div>
      );
    }
    const { rerender } = render(<Unkeyed tick={0} />);
    act(() => screen.getByText("start").click());
    act(() => screen.getByText("finish").click());
    rerender(<Unkeyed tick={1} />);
    act(() => screen.getByText("start").click());
    expect(shows()).toBe("no");
  });
});
