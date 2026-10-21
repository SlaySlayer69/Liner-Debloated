import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playerEngine, usePlayerStore } from "./playerEngine";
import { api } from "@/shared/api";
import type { Track } from "@/shared/types";

const mk = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artists: `Artist ${id}`,
  durationMs: 180000,
  coverUrl: "",
  playCount: 0,
});

const radioItems = (ids: string[]) =>
  ({ items: ids.map((id) => ({ id, title: `Track ${id}`, artists: `Artist ${id}`, durationMs: 180000 })) }) as any;

describe("radio playback", () => {
  let getRadio: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    usePlayerStore.setState({
      status: "idle",
      queue: [],
      currentIndex: -1,
      currentTrack: null,
      positionMs: 0,
      durationMs: 0,
      repeat: "off",
      shuffle: false,
      error: null,
      autoplaySimilar: false,
      playbackContext: null,
    });
    getRadio = vi.spyOn(api, "getRadio");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("turns repeat-all off when a station starts", async () => {
    getRadio.mockResolvedValue(radioItems(["b", "c"]));
    playerEngine.setRepeat("all");
    await playerEngine.startRadioStation(mk("a"));
    expect(usePlayerStore.getState().repeat).toBe("off");
  });

  it("refills when one track is left, even with autoplay-similar off", async () => {
    getRadio.mockResolvedValueOnce(radioItems(["b", "c"])); // station start
    await playerEngine.startRadioStation(mk("a"));
    expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(["a", "b", "c"]);

    getRadio.mockResolvedValueOnce(radioItems(["d", "e"]));
    await playerEngine.skipNext(); // on "b": one left after it -> refill
    await vi.advanceTimersByTimeAsync(500);
    expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("never wraps to the first track; at the end it fetches more and keeps going", async () => {
    getRadio.mockResolvedValueOnce(radioItems([])); // station start returns nothing
    await playerEngine.startRadioStation(mk("a"));
    usePlayerStore.getState().setRepeat("all"); // even if repeat-all sneaks in

    getRadio.mockResolvedValueOnce(radioItems(["x"]));
    await playerEngine.skipNext(true);
    const state = usePlayerStore.getState();
    expect(state.currentTrack?.id).toBe("x");
    expect(state.currentIndex).toBe(1);
  });

  it("plain playlists still loop with repeat-all", async () => {
    const tracks = [mk("1"), mk("2")];
    await playerEngine.playTrack(tracks[0], tracks, "playlist:p");
    playerEngine.setRepeat("all");
    await playerEngine.skipNext();
    await playerEngine.skipNext();
    expect(usePlayerStore.getState().currentTrack?.id).toBe("1");
  });

  describe("collection radio", () => {
    const pool = ["o1", "o2", "o3", "o4"].map(mk);
    const source = { kind: "playlist" as const, id: "p1", title: "Mine" };

    it("plays one of the collection's songs, then mixes in similar songs that are new", async () => {
      // similar songs may contain collection songs; those must not count as "similar"
      getRadio.mockResolvedValue(radioItems(["s1", "o2", "s2"]));
      expect(playerEngine.startCollectionRadio(source, pool)).toBe(true);
      const startState = usePlayerStore.getState();
      expect(startState.playbackContext).toBe("radio:collection:playlist:p1");
      expect(pool.map((t) => t.id)).toContain(startState.currentTrack?.id);

      await vi.advanceTimersByTimeAsync(0);
      const queue = usePlayerStore.getState().queue.map((t) => t.id);
      // every own song, each followed by a new similar one while they last
      expect(queue.filter((id) => id.startsWith("o")).sort()).toEqual(["o1", "o2", "o3", "o4"]);
      expect(queue.filter((id) => id.startsWith("s"))).toEqual(["s1", "s2"]);
      // the song that started the radio is followed by a similar one, then they alternate
      expect(queue[1]).toBe("s1");
      expect(queue[2]).toMatch(/^o/);
      expect(queue[3]).toBe("s2");
      expect(new Set(queue).size).toBe(queue.length);
    });

    it("keeps going once the queue runs low, repeating own songs only later", async () => {
      getRadio.mockResolvedValue(radioItems([]));
      playerEngine.startCollectionRadio(source, pool.slice(0, 2));
      await vi.advanceTimersByTimeAsync(0);
      expect(usePlayerStore.getState().queue).toHaveLength(2);

      getRadio.mockResolvedValue(radioItems(["s9"]));
      await playerEngine.skipNext(); // last track: refill
      await vi.advanceTimersByTimeAsync(500);
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toContain("s9");
    });

    it("does nothing for an empty collection", () => {
      expect(playerEngine.startCollectionRadio(source, [])).toBe(false);
    });

    it("stops refilling for a collection radio that is no longer playing", async () => {
      getRadio.mockResolvedValue(radioItems(["s1"]));
      playerEngine.startCollectionRadio(source, pool);
      await playerEngine.playTrack(mk("x"), [mk("x")], "playlist:other");
      await vi.advanceTimersByTimeAsync(500);
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(["x"]);
    });
  });
});

