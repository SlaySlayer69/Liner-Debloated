import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, toClientTrack } from "@/shared/api";
import type { Track } from "@/shared/types";
import { interleave, pickSeeds } from "@/features/player/engine/collectionRadio";

export const SUGGESTION_COUNT = 10;
const SEED_COUNT = 3;

// last suggestions per playlist, so coming back to a playlist doesn't reshuffle them
const cache = new Map<string, Track[]>();

function randomWaveId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/**
 * songs similar to a few random songs of the playlist, none of which is in the playlist
 * already; `exclude` keeps a reload from showing the same suggestions again
 */
export async function fetchPlaylistSuggestions(
  tracks: readonly Track[],
  exclude: readonly Track[] = [],
  random: () => number = Math.random,
): Promise<Track[]> {
  if (tracks.length === 0) return [];
  const waveId = randomWaveId();
  const results = await Promise.allSettled(
    pickSeeds(tracks, SEED_COUNT, random).map((seed) => api.getRadio(seed.id, { k: 15, wave_id: waveId })),
  );
  const lists = results.map((result) =>
    result.status === "fulfilled" ? result.value.items.map(toClientTrack) : [],
  );
  if (results.every((result) => result.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }

  const skip = new Set([...tracks, ...exclude].map((track) => track.id));
  const out: Track[] = [];
  for (const track of interleave(lists)) {
    if (!track.id || skip.has(track.id)) continue;
    skip.add(track.id);
    out.push(track);
    if (out.length >= SUGGESTION_COUNT) break;
  }
  return out;
}

export function usePlaylistSuggestions(playlistId: string | null, tracks: readonly Track[]) {
  const [items, setItems] = useState<Track[]>(() => (playlistId ? cache.get(playlistId) ?? [] : []));
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const loadSeq = useRef(0);
  const hasTracks = tracks.length > 0;

  const load = useCallback(
    async (exclude: readonly Track[] = []) => {
      if (!playlistId) return;
      const seq = ++loadSeq.current;
      setIsLoading(true);
      setFailed(false);
      try {
        let next = await fetchPlaylistSuggestions(tracksRef.current, exclude);
        // a small catalog may have nothing new left: fall back to allowing repeats
        if (next.length === 0 && exclude.length > 0) next = await fetchPlaylistSuggestions(tracksRef.current);
        if (seq !== loadSeq.current) return;
        cache.set(playlistId, next);
        setItems(next);
      } catch {
        if (seq === loadSeq.current) setFailed(true);
      } finally {
        if (seq === loadSeq.current) setIsLoading(false);
      }
    },
    [playlistId],
  );

  useEffect(() => {
    if (!playlistId) return;
    const cached = cache.get(playlistId);
    if (cached) {
      setItems(cached);
      return;
    }
    setItems([]);
    if (hasTracks) void load();
  }, [playlistId, hasTracks, load]);

  // songs that made it into the playlist leave the suggestions
  const visible = useMemo(() => {
    const inPlaylist = new Set(tracks.map((track) => track.id));
    return items.filter((track) => !inPlaylist.has(track.id));
  }, [items, tracks]);

  const reload = useCallback(() => load(items), [load, items]);

  const remove = useCallback(
    (trackId: string) => {
      setItems((prev) => {
        const next = prev.filter((track) => track.id !== trackId);
        if (playlistId) cache.set(playlistId, next);
        return next;
      });
    },
    [playlistId],
  );

  return { items: visible, isLoading, failed, reload, remove };
}
