import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "@/shared/api";
import type { Track } from "@/shared/types";
import { fetchPlaylistSuggestions, SUGGESTION_COUNT } from "./usePlaylistSuggestions";

vi.mock("@/shared/api", () => ({
  api: { getRadio: vi.fn() },
  toClientTrack: (track: any) => ({ id: track.id, title: track.id, artists: "", coverUrl: "", durationMs: 0, playCount: 0 }),
}));

const t = (id: string): Track => ({ id, title: id, artists: "", coverUrl: "", durationMs: 0, playCount: 0 });
const radio = (...ids: string[]) => ({ items: ids.map((id) => ({ id })) }) as any;

describe("fetchPlaylistSuggestions", () => {
  beforeEach(() => {
    vi.mocked(api.getRadio).mockReset();
  });

  it("mixes the seeds' radios and leaves out songs already in the playlist", async () => {
    vi.mocked(api.getRadio)
      .mockResolvedValueOnce(radio("x1", "p2", "x2"))
      .mockResolvedValueOnce(radio("y1", "x1"))
      .mockResolvedValueOnce(radio("z1"));

    const playlist = [t("p1"), t("p2"), t("p3")];
    const result = await fetchPlaylistSuggestions(playlist);

    expect(api.getRadio).toHaveBeenCalledTimes(3);
    expect(result.map((track) => track.id)).toEqual(["x1", "y1", "z1", "x2"]);
  });

  it("skips excluded songs, so a reload shows new ones", async () => {
    vi.mocked(api.getRadio).mockResolvedValue(radio("a", "b", "c"));
    const result = await fetchPlaylistSuggestions([t("p1")], [t("a"), t("b")]);
    expect(result.map((track) => track.id)).toEqual(["c"]);
  });

  it("caps the list and tolerates a failing seed", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `s${i}`);
    vi.mocked(api.getRadio).mockRejectedValueOnce(new Error("down")).mockResolvedValue(radio(...many));
    const result = await fetchPlaylistSuggestions([t("p1"), t("p2")]);
    expect(result).toHaveLength(SUGGESTION_COUNT);
  });

  it("fails when every lookup fails, and needs songs to start from", async () => {
    vi.mocked(api.getRadio).mockRejectedValue(new Error("offline"));
    await expect(fetchPlaylistSuggestions([t("p1")])).rejects.toThrow("offline");
    expect(await fetchPlaylistSuggestions([])).toEqual([]);
  });
});
