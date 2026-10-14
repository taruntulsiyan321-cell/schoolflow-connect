import { describe, expect, it, vi } from "vitest";
import { installNetworkGuard } from "./networkGuard";

/**
 * The guard is installed on a stand-in here, not on the real globals: the
 * suite's own guard (src/test/setup.ts) would fail this test for every request
 * these cases make on purpose.
 */

function standIn() {
  const realFetch = vi.fn(async () => new Response("local"));
  class Socket {
    url: string;
    constructor(url: string | URL) {
      this.url = String(url);
    }
  }
  const target = { fetch: realFetch as unknown as typeof fetch, WebSocket: Socket as unknown as typeof WebSocket };
  return { target, realFetch, guard: installNetworkGuard(target) };
}

describe("the network guard", () => {
  it("refuses an absolute address in every form fetch takes, and remembers each once", async () => {
    const { target, realFetch, guard } = standIn();
    await expect(target.fetch("https://x.supabase.co/rest/v1/rpc/rpc_my_premium")).rejects.toThrow(/do not reach the network/);
    await expect(target.fetch(new URL("http://example.com/a?token=1"))).rejects.toThrow(TypeError);
    await expect(target.fetch(new Request("https://x.supabase.co/rest/v1/rpc/rpc_my_premium?b=2"))).rejects.toThrow(TypeError);
    expect(realFetch).not.toHaveBeenCalled();
    expect(guard.takeReached()).toEqual(["https://x.supabase.co/rest/v1/rpc/rpc_my_premium", "http://example.com/a"]);
    // Taken means cleared: the next test starts with nothing against it.
    expect(guard.takeReached()).toEqual([]);
  });

  it("CONTROL: a relative address is jsdom's own and passes through", async () => {
    const { target, realFetch, guard } = standIn();
    await expect(target.fetch("/assets/app.css")).resolves.toBeInstanceOf(Response);
    expect(realFetch).toHaveBeenCalledWith("/assets/app.css", undefined);
    expect(guard.takeReached()).toEqual([]);
  });

  it("points a socket for a real server at a closed local port, and remembers the server", () => {
    const { target, guard } = standIn();
    const socket = new target.WebSocket("wss://x.supabase.co/realtime/v1/websocket?apikey=k");
    expect(socket.url).toBe("ws://127.0.0.1:9");
    expect(guard.takeReached()).toEqual(["wss://x.supabase.co/realtime/v1/websocket"]);
  });
});
