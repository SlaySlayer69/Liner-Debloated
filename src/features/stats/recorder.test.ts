import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "@/shared/api";
import { statsDb } from "./store/statsDb";
import { ensureHistoryBackfill, historyItemToRecord, recordListen } from "./recorder";

const session = { user: { id: "u1" } };

vi.mock("@/shared/api", () => ({
  api: { getHistory: vi.fn() },
  getAuthSession: () => session,
  toClientTrack: (track: any) => ({
    id: track.id,
    title: track.title,
    artists: (track.artists || []).map((a: any) => a.name).join(", "),
    artistList: track.artists,
    coverUrl: track.cover?.url || "",
    durationMs: track.durationMs || 0,
    playCount: 0,
    album: track.album,
  }),
}));

function historyItem(id: string, listenedAt: string) {
  return {
    id,
    playbackSessionId: "p",
    listeningSessionId: "l",
    track: { id: `track-${id}`, title: `Song ${id}`, artists: [{ id: "a1", name: "Artist" }], durationMs: 180_000 },
    playedDurationMs: 120_000,
    completionRate: 0.66,
    completed: false,
    skipped: false,
    loopCount: 0,
    hasSeekBackward: false,
    listenedAt,
  };
}

describe("stats recorder", () => {
  beforeEach(() => {
    statsDb.resetForTests();
    localStorage.clear();
    vi.mocked(api.getHistory).mockReset();
  });

  it("stores every reported listen for the signed in account", async () => {
    recordListen(
      {
        track: {
          id: "t1",
          title: "Song",
          artists: "A, B",
          artistList: [{ id: "a", name: "A" }, { name: "B" }],
          coverUrl: "c",
          durationMs: 200_000,
          playCount: 0,
          album: { id: "al", title: "Album" },
        },
        trackId: "t1",
        playedMs: 45_000.6,
        durationMs: 200_000,
        completed: false,
      },
      5_000,
    );

    const records = await statsDb.getRange("u1", 0, 10_000);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      owner: "u1",
      ts: 5_000,
      trackId: "t1",
      artists: [{ id: "a", name: "A" }, { id: undefined, name: "B" }],
      albumId: "al",
      playedMs: 45_001,
      completed: false,
    });
    expect(await statsDb.getRange("someone-else", 0, 10_000)).toEqual([]);
  });

  it("maps server history items to records", () => {
    const record = historyItemToRecord(historyItem("h1", "2026-10-01T10:00:00.000Z") as any, "u1");
    expect(record).toMatchObject({
      id: "srv:h1",
      ts: Date.parse("2026-10-01T10:00:00.000Z"),
      trackId: "track-h1",
      playedMs: 120_000,
    });
    expect(historyItemToRecord({ ...historyItem("h2", "not a date") } as any, "u1")).toBeNull();
  });

  it("imports only history from before local recording started, once", async () => {
    const epoch = Date.parse("2026-10-10T00:00:00.000Z");
    localStorage.setItem("liner_stats_epoch_v1:u1", String(epoch));
    vi.mocked(api.getHistory)
      .mockResolvedValueOnce({
        items: [historyItem("new", "2026-10-12T00:00:00.000Z"), historyItem("old1", "2026-10-05T00:00:00.000Z")],
        nextCursor: "c2",
      } as any)
      .mockResolvedValueOnce({ items: [historyItem("old2", "2026-09-01T00:00:00.000Z")], nextCursor: null } as any);

    await ensureHistoryBackfill("u1");

    expect(api.getHistory).toHaveBeenNthCalledWith(1, undefined, 100);
    expect(api.getHistory).toHaveBeenNthCalledWith(2, "c2", 100);
    const ids = (await statsDb.getRange("u1", 0, Number.MAX_SAFE_INTEGER)).map((r) => r.id);
    expect(ids).toEqual(["srv:old2", "srv:old1"]);

    await ensureHistoryBackfill("u1");
    expect(api.getHistory).toHaveBeenCalledTimes(2);
  });

  it("retries the import on the next visit after a failure", async () => {
    vi.mocked(api.getHistory).mockRejectedValueOnce(new Error("offline"));
    await ensureHistoryBackfill("u1");
    vi.mocked(api.getHistory).mockResolvedValueOnce({ items: [], nextCursor: null } as any);
    await ensureHistoryBackfill("u1");
    expect(api.getHistory).toHaveBeenCalledTimes(2);
  });
});
