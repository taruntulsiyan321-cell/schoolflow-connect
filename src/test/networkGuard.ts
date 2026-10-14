/**
 * TESTS DO NOT REACH THE NETWORK (KNOWN_ISSUES 132).
 *
 * Until 2026-10-13 any call a test left unmocked went to PRODUCTION Supabase.
 * Every full run sent ~500 anonymous requests with fixture ids ("u", "u1")
 * from 10 files, which filled the live error log, and the screens under test
 * drew whatever production happened to answer.
 *
 * This refuses every absolute http(s) or ws(s) address, a fetch or a
 * WebSocket, and remembers it. src/test/setup.ts fails the test that made the
 * request. Relative URLs, which are jsdom's own, pass through.
 */

type Target = { fetch: typeof fetch; WebSocket?: typeof WebSocket };

const ABSOLUTE = /^(https?|wss?):\/\//i;

export function installNetworkGuard(target: Target) {
  const reached: string[] = [];
  const realFetch = target.fetch;

  target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (ABSOLUTE.test(url)) {
      reached.push(url.split("?")[0]);
      return Promise.reject(new TypeError(`Tests do not reach the network: ${url}`));
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const RealSocket = target.WebSocket;
  if (RealSocket) {
    // A socket cannot be refused at construction without throwing where a real
    // one never would. Instead it is pointed at a closed local port, so it fails
    // the way an unreachable server does: an error, then a close.
    target.WebSocket = class GuardedSocket extends RealSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const href = String(url);
        if (ABSOLUTE.test(href)) reached.push(href.split("?")[0]);
        super(ABSOLUTE.test(href) ? "ws://127.0.0.1:9" : href, protocols);
      }
    } as typeof WebSocket;
  }

  /** The addresses asked for since the last call, each once. */
  const takeReached = () => [...new Set(reached.splice(0))];
  return { takeReached };
}
