/**
 * The Deno globals the edge functions use, and their one other remote import,
 * for `tsconfig.edge.json` (docs/TODO.md E6). Only what the functions call
 * (counted 2026-10-13: Deno.env.get 84, Deno.serve 21, Deno.env.toObject 5).
 */

declare namespace Deno {
  const env: {
    get(name: string): string | undefined;
    toObject(): Record<string, string>;
  };
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  function serve(
    options: Record<string, unknown>,
    handler: (request: Request) => Response | Promise<Response>,
  ): unknown;
}

/**
 * Deno 2 provides Node's `process` as a global. Two shared modules fall back
 * to it, behind `typeof process !== "undefined"`, so the same code reads its
 * keys under vitest (Node) too.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;

/** custom-practice-upload reads PDFs with it (dynamic import, media.ts). */
declare module "https://esm.sh/unpdf@0.12.1" {
  export function getDocumentProxy(data: Uint8Array | ArrayBuffer): Promise<unknown>;
  export function extractText(
    pdf: unknown,
    options?: { mergePages?: boolean },
  ): Promise<{ totalPages: number; text: string | string[] }>;
}
