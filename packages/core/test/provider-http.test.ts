import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, numberOr, openSse, sseData } from "../src/provider/http";
import { collect, sseResponse } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider http helpers", () => {
  it("parses multi-frame SSE streams", async () => {
    const response = sseResponse(["data: one\n\ndata: two\n\n"]);
    expect(await collect(sseData(response))).toEqual(["one", "two"]);
  });

  it("ignores non-data lines and flushes a trailing frame", async () => {
    const response = sseResponse([": comment\n\ndata: last\n"]);
    expect(await collect(sseData(response))).toEqual(["last"]);
  });

  it("opens SSE responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => sseResponse(["data: ok\n\n"])),
    );
    const response = await openSse(
      "https://example.test/stream",
      { method: "POST", body: "{}" },
      new AbortController().signal,
    );
    expect(await collect(sseData(response))).toEqual(["ok"]);
  });

  it("throws a provider error for non-ok SSE responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("nope", { status: 503 })),
    );
    await expect(
      openSse("https://example.test/stream", {}, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider_error", details: { status: 503 } });
  });

  it("fetches JSON and throws on HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(
      fetchJson("https://example.test/data", {}, new AbortController().signal),
    ).resolves.toEqual({ ok: true });

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("bad", { status: 400 })),
    );
    await expect(
      fetchJson("https://example.test/data", {}, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider_error" });
  });

  it("coerces numbers safely", () => {
    expect(numberOr(3, 0)).toBe(3);
    expect(numberOr("3", 0)).toBe(0);
    expect(numberOr(Number.NaN, 7)).toBe(7);
  });
});
