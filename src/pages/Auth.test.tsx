/**
 * The sign-in page (2026-10-02): mobile number and OTP in the page's own
 * fields, CUET without asking, and two doors — Log In and Register — that both
 * reach a working account for a new number and for a known one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const widget = vi.hoisted(() => ({
  configured: true,
  start: vi.fn(),
  send: vi.fn(),
  resend: vi.fn(),
  verify: vi.fn(),
}));
const signIn = vi.hoisted(() => ({ complete: vi.fn() }));
const db = vi.hoisted(() => ({ rpc: vi.fn() }));
const auth = vi.hoisted(() => ({
  value: {
    user: null, role: null, loading: false, status: "unauthenticated", homePath: "/student",
    refreshAuth: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@/auth", () => ({
  useAuth: () => auth.value,
  dashboardForRole: () => "/student",
  canAccessPath: () => true,
}));
vi.mock("@/lib/msg91Widget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/msg91Widget")>();
  return {
    ...actual,
    isMsg91WidgetConfigured: () => widget.configured,
    startMsg91: widget.start,
    sendMsg91Otp: widget.send,
    resendMsg91Otp: widget.resend,
    verifyMsg91Otp: widget.verify,
  };
});
vi.mock("@/lib/msg91Auth", () => ({ completeMsg91SignIn: signIn.complete }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: db.rpc } }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const { default: Auth } = await import("./Auth");

const SETTINGS = { otpLength: 4, resendAfterSec: 30, resendsAllowed: 2, resendChannel: "11" };
const TOKEN = { token: "eyJ.access.token", keys: ["message"], jwt_shaped: true, length: 16 };

function show(path = "/auth") {
  return render(<MemoryRouter initialEntries={[path]}><Auth /></MemoryRouter>);
}
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const button = (name: RegExp) => screen.getByRole("button", { name });

async function sendCodeTo(number: string) {
  await waitFor(() => expect(button(/send otp/i)).toBeEnabled());
  fireEvent.change(field(/mobile number/i), { target: { value: number } });
  fireEvent.click(button(/send otp/i));
}

beforeEach(() => {
  widget.configured = true;
  widget.start.mockReset().mockResolvedValue(SETTINGS);
  widget.send.mockReset().mockResolvedValue(undefined);
  widget.resend.mockReset().mockResolvedValue(undefined);
  widget.verify.mockReset().mockResolvedValue(TOKEN);
  signIn.complete.mockReset().mockResolvedValue({ ok: true, is_new_user: false, verified_phone_masked: "+91 ******3210" });
  db.rpc.mockReset().mockResolvedValue({ error: null });
});

describe("the sign-in page", () => {
  it("asks for a mobile number and a code — no exam, no email, no password", async () => {
    show();
    expect(screen.getByRole("heading", { name: "Welcome Back" })).toBeInTheDocument();
    expect(field(/mobile number/i)).toBeInTheDocument();
    expect(field(/^otp$/i)).toBeDisabled();
    await waitFor(() => expect(button(/send otp/i)).toBeEnabled());
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/which exam|email|password|organi[sz]ation/i);
    // CONTROL: the matcher does see the page's own words.
    expect(text).toMatch(/Register Now/);
  });

  it("refuses a number that is not an Indian mobile, and sends nothing", async () => {
    show();
    await sendCodeTo("12345");
    expect(await screen.findByText(/valid 10-digit mobile number/i)).toBeInTheDocument();
    expect(widget.send).not.toHaveBeenCalled();
  });

  it("texts the code to the number however it was typed (control for the refusal above)", async () => {
    show();
    await sendCodeTo("+91 98765 43210");
    await waitFor(() => expect(widget.send).toHaveBeenCalledWith("9876543210"));
    expect(await screen.findByText(/sent a code to \+91 98765 43210/i)).toBeInTheDocument();
    expect(field(/^otp$/i)).toBeEnabled();
    expect(button(/^log in$/i)).toBeInTheDocument();
  });

  it("logs a known number straight in, for CUET, without asking for a name", async () => {
    show();
    await sendCodeTo("9876543210");
    await screen.findByText(/sent a code/i);
    fireEvent.change(field(/^otp$/i), { target: { value: "1234" } });
    fireEvent.click(button(/^log in$/i));
    await waitFor(() => expect(signIn.complete).toHaveBeenCalledWith(TOKEN.token, "cuet", expect.objectContaining({ length: 16 })));
    expect(widget.verify).toHaveBeenCalledWith("1234");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(screen.queryByText(/almost there/i)).not.toBeInTheDocument();
  });

  it("a new number through Log In is asked for its name, then saved", async () => {
    signIn.complete.mockResolvedValue({ ok: true, is_new_user: true, verified_phone_masked: "" });
    show();
    await sendCodeTo("9876543210");
    await screen.findByText(/sent a code/i);
    fireEvent.change(field(/^otp$/i), { target: { value: "1234" } });
    fireEvent.click(button(/^log in$/i));
    expect(await screen.findByRole("heading", { name: /almost there/i })).toBeInTheDocument();
    fireEvent.change(field(/full name/i), { target: { value: "  Asha Verma " } });
    fireEvent.click(button(/continue/i));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("rpc_set_my_display_name", { _full_name: "Asha Verma" }));
    expect(auth.value.refreshAuth).toHaveBeenCalled();
  });

  it("Register takes the name up front and saves it with the new account", async () => {
    signIn.complete.mockResolvedValue({ ok: true, is_new_user: true, verified_phone_masked: "" });
    show("/auth?mode=register");
    expect(screen.getByRole("heading", { name: "Create Your Account" })).toBeInTheDocument();
    await sendCodeTo("9876543210");
    // The name is required before a code goes out.
    expect(await screen.findByText(/enter your full name/i)).toBeInTheDocument();
    expect(widget.send).not.toHaveBeenCalled();
    fireEvent.change(field(/full name/i), { target: { value: "Asha Verma" } });
    fireEvent.click(button(/send otp/i));
    await screen.findByText(/sent a code/i);
    fireEvent.change(field(/^otp$/i), { target: { value: "1234" } });
    fireEvent.click(button(/^register$/i));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("rpc_set_my_display_name", { _full_name: "Asha Verma" }));
    expect(signIn.complete).toHaveBeenCalledWith(TOKEN.token, "cuet", expect.anything());
  });

  it("Register with a number that already has an account signs it in and leaves its name alone", async () => {
    show("/auth?mode=register");
    await waitFor(() => expect(button(/send otp/i)).toBeEnabled());
    fireEvent.change(field(/full name/i), { target: { value: "Someone Else" } });
    await sendCodeTo("9876543210");
    await screen.findByText(/sent a code/i);
    fireEvent.change(field(/^otp$/i), { target: { value: "1234" } });
    fireEvent.click(button(/^register$/i));
    await waitFor(() => expect(signIn.complete).toHaveBeenCalled());
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("switches between Log In and Register", async () => {
    show();
    fireEvent.click(button(/register now/i));
    expect(screen.getByRole("heading", { name: "Create Your Account" })).toBeInTheDocument();
    expect(field(/full name/i)).toBeInTheDocument();
    fireEvent.click(button(/^log in\.$/i));
    expect(screen.getByRole("heading", { name: "Welcome Back" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/full name/i)).not.toBeInTheDocument();
  });

  it("says a wrong code is wrong, and does not sign in", async () => {
    widget.verify.mockRejectedValue({ code: 703, message: "OTP not match" });
    show();
    await sendCodeTo("9876543210");
    await screen.findByText(/sent a code/i);
    fireEvent.change(field(/^otp$/i), { target: { value: "9999" } });
    fireEvent.click(button(/^log in$/i));
    expect(await screen.findByText(/that code isn't right/i)).toBeInTheDocument();
    expect(signIn.complete).not.toHaveBeenCalled();
  });

  it("asks for the whole code before checking it", async () => {
    show();
    await sendCodeTo("9876543210");
    await screen.findByText(/sent a code/i);
    fireEvent.change(field(/^otp$/i), { target: { value: "12" } });
    fireEvent.click(button(/^log in$/i));
    expect(await screen.findByText(/enter the 4-digit code/i)).toBeInTheDocument();
    expect(widget.verify).not.toHaveBeenCalled();
  });

  it("offers a resend only after the wait", async () => {
    show();
    await sendCodeTo("9876543210");
    expect(await screen.findByText(/resend in \d+s/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resend otp/i })).not.toBeInTheDocument();
  });

  it("when mobile sign-in cannot start, says so and offers to try again", async () => {
    widget.start.mockRejectedValue(new Error("network"));
    show();
    expect(await screen.findByText(/couldn't start/i)).toBeInTheDocument();
    expect(button(/send otp/i)).toBeDisabled();
    widget.start.mockResolvedValue(SETTINGS);
    fireEvent.click(button(/try again/i));
    await waitFor(() => expect(button(/send otp/i)).toBeEnabled());
  });
});
