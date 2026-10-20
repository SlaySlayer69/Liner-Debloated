import { describe, expect, it } from "vitest";
import { summarize, summarizeGenres, countsAsPlay, type PlayRecord } from "./aggregate";

let seq = 0;
function rec(partial: Partial<PlayRecord>): PlayRecord {
  return {
    id: `r${seq++}`,
    owner: "u1",
    ts: 1_000,
    trackId: "t1",
    title: "Song",
    artists: [{ id: "a1", name: "Artist One" }],
    coverUrl: "cover-1",
    durationMs: 200_000,
    playedMs: 200_000,
    completed: true,
    ...partial,
  };
}

describe("countsAsPlay", () => {
  it("needs 30 seconds or a finished track", () => {
    expect(countsAsPlay({ playedMs: 29_999, completed: false })).toBe(false);
    expect(countsAsPlay({ playedMs: 30_000, completed: false })).toBe(true);
    expect(countsAsPlay({ playedMs: 5_000, completed: true })).toBe(true);
  });
});

describe("summarize", () => {
  it("totals time and plays, ranks tracks and artists by listening time", () => {
    const summary = summarize([
      rec({ trackId: "t1", playedMs: 180_000 }),
      rec({ trackId: "t1", playedMs: 10_000, completed: false }),
      rec({
        trackId: "t2",
        title: "Duet",
        artists: [
          { id: "a1", name: "Artist One" },
          { id: "a2", name: "Artist Two" },
        ],
        playedMs: 300_000,
      }),
    ]);

    expect(summary.totalMs).toBe(490_000);
    // the 10s skip is listening time but not a play
    expect(summary.playCount).toBe(2);
    expect(summary.uniqueTracks).toBe(2);
    expect(summary.uniqueArtists).toBe(2);

    expect(summary.topTracks.map((t) => [t.track.id, t.plays, t.listenedMs])).toEqual([
      ["t2", 1, 300_000],
      ["t1", 1, 190_000],
    ]);
    expect(summary.topTracks[0].track.artists).toBe("Artist One, Artist Two");

    // the duet's time is split between both artists, its play counts for each
    expect(summary.topArtists.map((a) => [a.name, a.plays, a.listenedMs])).toEqual([
      ["Artist One", 2, 340_000],
      ["Artist Two", 1, 150_000],
    ]);
  });

  it("groups artists without an id by name", () => {
    const summary = summarize([
      rec({ trackId: "x", artists: [{ id: "unknown", name: "Local Band" }] }),
      rec({ trackId: "y", artists: [{ name: " local band " }] }),
    ]);
    expect(summary.uniqueArtists).toBe(1);
    expect(summary.topArtists[0].id).toBeUndefined();
    expect(summary.topArtists[0].plays).toBe(2);
  });

  it("fills chart buckets by listen time", () => {
    const buckets = [
      { start: 0, end: 100 },
      { start: 100, end: 200 },
    ];
    const summary = summarize(
      [rec({ ts: 50, playedMs: 1_000 }), rec({ ts: 150, playedMs: 2_000 }), rec({ ts: 199, playedMs: 3_000 }), rec({ ts: 500 })],
      buckets,
    );
    expect(summary.bucketMs).toEqual([1_000, 5_000]);
  });

  it("is empty without listens", () => {
    const summary = summarize([], [{ start: 0, end: 1 }]);
    expect(summary).toMatchObject({ totalMs: 0, playCount: 0, topTracks: [], topArtists: [], bucketMs: [0] });
  });
});

describe("summarizeGenres", () => {
  it("weights genres by artist listening time and skips unknown ones", () => {
    const { topArtists } = summarize([
      rec({ trackId: "1", artists: [{ id: "a", name: "A" }], playedMs: 600_000 }),
      rec({ trackId: "2", artists: [{ id: "b", name: "B" }], playedMs: 200_000 }),
      rec({ trackId: "3", artists: [{ id: "c", name: "C" }], playedMs: 200_000 }),
      rec({ trackId: "4", artists: [{ id: "d", name: "D" }], playedMs: 900_000 }),
    ]);
    const genres = summarizeGenres(topArtists, (a) => ({ A: "Rock", B: "Rock", C: "Hip-Hop/Rap" } as Record<string, string>)[a.name]);
    expect(genres).toEqual([
      { genre: "Rock", listenedMs: 800_000, share: 0.8 },
      { genre: "Hip-Hop/Rap", listenedMs: 200_000, share: 0.2 },
    ]);
  });
});
