import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getCachedGenre, lookupGenre, pickGenre } from "./genres";

describe("pickGenre", () => {
  it("prefers the exact artist name, falls back to the first hit", () => {
    const results = [
      { artistName: "Gorillaz Tribute", primaryGenreName: "Pop" },
      { artistName: "Gorillaz", primaryGenreName: "Alternative" },
    ];
    expect(pickGenre("gorillaz", results)).toBe("Alternative");
    expect(pickGenre("Someone Else", results)).toBe("Pop");
    expect(pickGenre("Nobody", [])).toBe("");
  });
});

describe("lookupGenre", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the network once per artist and remembers the answer", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ artistName: "Radiohead", primaryGenreName: "Alternative" }] }),
    });

    expect(await lookupGenre("Radiohead")).toBe("Alternative");
    expect(await lookupGenre("RADIOHEAD ")).toBe("Alternative");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("term=Radiohead");
    expect(getCachedGenre("radiohead")).toBe("Alternative");
  });

  it("does not cache network failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await lookupGenre("Unreachable Band")).toBeNull();
    expect(getCachedGenre("Unreachable Band")).toBeUndefined();
  });
});
