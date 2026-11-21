import type { Track } from "@/shared/contracts";
import {
  SpotifyApiError,
  type SpotifyAlbum,
  type SpotifyArtist,
  type SpotifyClient,
  type SpotifyPlaylist,
  type SpotifyTrack,
} from "../api/spotifyClient";
import type {
  CachedMatch,
  CollectionSnapshot,
  SpotifySyncSettings,
  SyncedEntry,
  SyncedPlaylist,
  SyncLedger,
  SyncResult,
} from "./types";
import { syncLinkedSources } from "../links/linkSync";
import type { PublicSpotifySource } from "../links/publicSource";

// a failed lookup is tried again after a week: the catalog may have the song by then
export const UNMATCHED_RETRY_MS = 7 * 24 * 60 * 60_000;
export const MATCH_CONCURRENCY = 4;

export class LinerPlaylistMissingError extends Error {
  constructor() {
    super("liner_playlist_missing");
  }
}

/** the liner side of the sync; the real one talks to the liner api */
export interface LinerTarget {
  matchTrack(track: SpotifyTrack): Promise<Track | null>;
  matchAlbum(album: SpotifyAlbum): Promise<CollectionSnapshot | null>;
  matchArtist(artist: SpotifyArtist): Promise<CollectionSnapshot | null>;

  likedTrackIds(): Promise<Set<string>>;
  setLiked(trackId: string, liked: boolean): Promise<void>;

  savedCollectionIds(type: "albums" | "artists"): Promise<Set<string>>;
  saveCollection(
    type: "albums" | "artists",
    item: CollectionSnapshot,
  ): Promise<void>;
  removeCollection(type: "albums" | "artists", id: string): Promise<void>;

  createPlaylist(title: string, description?: string): Promise<string>;
  /** false once the user deleted the playlist in liner */
  hasPlaylist(playlistId: string): Promise<boolean>;
  /** adds the tracks and returns liner track id -> item id; throws LinerPlaylistMissingError */
  addPlaylistTracks(
    playlistId: string,
    tracks: Track[],
  ): Promise<Record<string, string>>;
  removePlaylistItem(playlistId: string, itemId: string): Promise<void>;
}

export interface SyncOptions {
  /** ignore the change markers and look at everything */
  force?: boolean;
  now?: () => number;
  /** persists the ledger after every section so an interrupted sync keeps its progress */
  commit?: (ledger: SyncLedger) => void;
  onProgress?: (step: string) => void;
  /** false without a spotify sign-in: only the public links are synced */
  account?: boolean;
  /** reads the linked public playlists and albums */
  publicSource?: PublicSpotifySource;
}

export interface Counters {
  added: number;
  removed: number;
  unmatched: number;
  playlists: number;
}

export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export function cachedLookup<S extends { id: string | null }, V>(
  cache: Record<string, CachedMatch<V>>,
  lookup: (item: S) => Promise<V | null>,
  now: number,
) {
  return async (item: S): Promise<V | null> => {
    const key = item.id!;
    const hit = cache[key];
    if (hit && (hit.value || now - hit.at < UNMATCHED_RETRY_MS))
      return hit.value;
    try {
      const value = await lookup(item);
      cache[key] = { value, at: now };
      return value;
    } catch {
      // a lookup that failed (offline, rate limit) is not cached
      return null;
    }
  };
}

/**
 * mirrors one "saved" list (liked songs, albums, artists) from spotify into liner.
 * entries the user already had are marked `own` and never removed.
 */
export async function mirrorSet<S extends { id: string | null }>(options: {
  source: S[];
  entries: Record<string, SyncedEntry>;
  match: (item: S) => Promise<string | null>;
  present: Set<string>;
  add: (spotifyItem: S, linerId: string) => Promise<void>;
  remove: (linerId: string) => Promise<void>;
  counters: Counters;
}) {
  const { source, entries, present, counters } = options;
  const wanted = new Set(source.map((item) => item.id!));

  const matched = await mapLimited(source, MATCH_CONCURRENCY, async (item) => ({
    item,
    linerId: await options.match(item),
  }));

  for (const { item, linerId } of matched) {
    const key = item.id!;
    if (!linerId) {
      if (!entries[key]) counters.unmatched += 1;
      continue;
    }
    if (entries[key]?.linerId === linerId) continue;
    if (present.has(linerId)) {
      // a different spotify entry may already have brought it in
      const ours = Object.values(entries).some(
        (entry) => entry.linerId === linerId && !entry.own,
      );
      entries[key] = { linerId, own: !ours };
      continue;
    }
    await options.add(item, linerId);
    present.add(linerId);
    entries[key] = { linerId, own: false };
    counters.added += 1;
  }

  for (const [key, entry] of Object.entries(entries)) {
    if (wanted.has(key)) continue;
    delete entries[key];
    if (entry.own) continue;
    const stillWanted = Object.values(entries).some(
      (other) => other.linerId === entry.linerId,
    );
    if (stillWanted || !present.has(entry.linerId)) continue;
    await options.remove(entry.linerId);
    present.delete(entry.linerId);
    counters.removed += 1;
  }
}

/** spotify only hands out the songs of playlists the user owns or collaborates on */
export function isReadablePlaylist(
  playlist: SpotifyPlaylist,
  userId: string,
): boolean {
  return playlist.owner?.id === userId || playlist.collaborative === true;
}

function playlistsToSync(
  settings: SpotifySyncSettings,
  playlists: SpotifyPlaylist[],
): SpotifyPlaylist[] {
  if (settings.playlistsMode === "all") return playlists;
  if (settings.playlistsMode === "selected") {
    const selected = new Set(settings.selectedPlaylists);
    return playlists.filter((playlist) => selected.has(playlist.id));
  }
  return [];
}

export function syncErrorCode(error: unknown): string {
  if (error instanceof SpotifyApiError)
    return error.status === 401 ? "not_connected" : `spotify_${error.status}`;
  return error instanceof Error ? error.message : "sync_failed";
}

export async function runSpotifySync(
  spotify: SpotifyClient,
  liner: LinerTarget,
  settings: SpotifySyncSettings,
  initial: SyncLedger,
  options: SyncOptions = {},
): Promise<{ ledger: SyncLedger; result: SyncResult }> {
  const now = options.now ?? Date.now;
  const ledger = structuredClone(initial);
  const counters: Counters = {
    added: 0,
    removed: 0,
    unmatched: 0,
    playlists: 0,
  };
  const errors: { code: string; detail?: string }[] = [];
  const commit = () => options.commit?.(ledger);
  const force = options.force ?? false;
  let skipped = true;
  let skippedPlaylists = 0;

  // one failing part (a missing scope, a 403 on one playlist) must not stop the others
  const attempt = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      errors.push({
        code: syncErrorCode(error),
        ...(error instanceof SpotifyApiError && error.detail
          ? { detail: error.detail }
          : {}),
      });
    }
  };

  const trackMatch = cachedLookup(ledger.trackMatches, liner.matchTrack, now());

  const account = options.account !== false;

  if (account && settings.liked)
    await attempt(async () => {
      const fingerprint = await spotify.libraryFingerprint("liked");
      if (!force && ledger.fingerprints.liked === fingerprint) return;
      skipped = false;
      options.onProgress?.("liked");
      const [tracks, present] = await Promise.all([
        spotify.savedTracks(),
        liner.likedTrackIds(),
      ]);
      await mirrorSet({
        source: tracks,
        entries: ledger.liked,
        match: async (track) => (await trackMatch(track))?.id ?? null,
        present,
        add: (_track, id) => liner.setLiked(id, true),
        remove: (id) => liner.setLiked(id, false),
        counters,
      });
      ledger.fingerprints.liked = fingerprint;
      commit();
    });

  const collections = [
    {
      key: "albums" as const,
      enabled: settings.albums,
      load: () => spotify.savedAlbums(),
      cache: ledger.albumMatches,
      lookup: liner.matchAlbum,
    },
    {
      key: "artists" as const,
      enabled: settings.artists,
      load: () => spotify.followedArtists(),
      cache: ledger.artistMatches,
      lookup: liner.matchArtist,
    },
  ];
  for (const section of collections) {
    if (!account || !section.enabled) continue;
    await attempt(async () => {
      const fingerprint = await spotify.libraryFingerprint(section.key);
      if (!force && ledger.fingerprints[section.key] === fingerprint) return;
      skipped = false;
      options.onProgress?.(section.key);
      const match = cachedLookup<
        SpotifyAlbum | SpotifyArtist,
        CollectionSnapshot
      >(
        section.cache,
        section.lookup as (
          item: SpotifyAlbum | SpotifyArtist,
        ) => Promise<CollectionSnapshot | null>,
        now(),
      );
      const [items, present] = await Promise.all([
        section.load(),
        liner.savedCollectionIds(section.key),
      ]);
      await mirrorSet<SpotifyAlbum | SpotifyArtist>({
        source: items,
        entries: ledger[section.key],
        match: async (item) => (await match(item))?.id ?? null,
        present,
        add: async (item) => {
          const snapshot = section.cache[item.id]?.value;
          if (snapshot) await liner.saveCollection(section.key, snapshot);
        },
        remove: (id) => liner.removeCollection(section.key, id),
        counters,
      });
      ledger.fingerprints[section.key] = fingerprint;
      commit();
    });
  }

  if (account && settings.playlistsMode !== "none")
    await attempt(async () => {
      const [profile, all] = await Promise.all([
        spotify.me(),
        spotify.playlists(),
      ]);
      for (const playlist of playlistsToSync(settings, all)) {
        if (!isReadablePlaylist(playlist, profile.id)) {
          skippedPlaylists += 1;
          continue;
        }
        const known = ledger.playlists[playlist.id];
        if (!force && known && known.snapshotId === playlist.snapshot_id)
          continue;
        skipped = false;
        options.onProgress?.(`playlist:${playlist.name}`);
        await attempt(() =>
          syncPlaylist(spotify, liner, ledger, playlist, trackMatch, counters),
        );
        commit();
      }
    });

  if (options.publicSource)
    if (
      await syncLinkedSources({
        source: options.publicSource,
        liner,
        ledger,
        links: settings.linkedSources ?? [],
        counters,
        force,
        now: now(),
        trackMatch,
        attempt,
        onProgress: options.onProgress,
        commit,
      })
    )
      skipped = false;

  const result: SyncResult = {
    finishedAt: now(),
    ...counters,
    skipped: skipped && errors.length === 0,
    ...(skippedPlaylists ? { skippedPlaylists } : {}),
    ...(errors[0] ? { error: errors[0].code } : {}),
    ...(errors[0]?.detail ? { errorDetail: errors[0].detail } : {}),
  };
  return { ledger, result };
}

async function syncPlaylist(
  spotify: SpotifyClient,
  liner: LinerTarget,
  ledger: SyncLedger,
  playlist: SpotifyPlaylist,
  trackMatch: (track: SpotifyTrack) => Promise<Track | null>,
  counters: Counters,
) {
  const tracks = await spotify.playlistTracks(playlist.id);
  await mirrorPlaylist(
    liner,
    ledger,
    playlist.id,
    {
      name: playlist.name,
      description: playlist.description,
      snapshotId: playlist.snapshot_id,
    },
    await mapLimited(tracks, MATCH_CONCURRENCY, trackMatch),
    counters,
    true,
  );
}

/**
 * brings the liner copy of one playlist in line with the matched songs.
 * without `allowRemovals` (an incomplete song list) it only adds.
 */
export async function mirrorPlaylist(
  liner: LinerTarget,
  ledger: SyncLedger,
  key: string,
  meta: { name: string; description?: string | null; snapshotId: string },
  matched: (Track | null)[],
  counters: Counters,
  allowRemovals: boolean,
) {
  counters.unmatched += matched.filter((track) => !track).length;

  const wanted = new Map<string, Track>();
  for (const track of matched) {
    if (track && !wanted.has(track.id)) wanted.set(track.id, track);
  }

  let state: SyncedPlaylist | undefined = ledger.playlists[key];
  const description = meta.description?.replace(/<[^>]*>/g, "").trim();
  if (state && !(await liner.hasPlaylist(state.linerId))) {
    delete ledger.playlists[key];
    state = undefined;
  }
  if (!state) {
    const linerId = await liner.createPlaylist(meta.name, description);
    state = { linerId, name: meta.name, snapshotId: "", items: {} };
    ledger.playlists[key] = state;
  }

  const applyDiff = async () => {
    const missing = [...wanted.values()].filter(
      (track) => !state.items[track.id],
    );
    if (missing.length > 0) {
      const added = await liner.addPlaylistTracks(state.linerId, missing);
      Object.assign(state.items, added);
      counters.added += Object.keys(added).length;
    }
    if (!allowRemovals) return;
    for (const [trackId, itemId] of Object.entries(state.items)) {
      if (wanted.has(trackId)) continue;
      await liner.removePlaylistItem(state.linerId, itemId);
      delete state.items[trackId];
      counters.removed += 1;
    }
  };

  try {
    await applyDiff();
  } catch (error) {
    if (!(error instanceof LinerPlaylistMissingError)) throw error;
    // the user deleted the copy in liner: start a fresh one
    state.linerId = await liner.createPlaylist(meta.name, description);
    state.items = {};
    await applyDiff();
  }

  state.name = meta.name;
  // an incomplete read must be looked at again next time
  state.snapshotId = allowRemovals ? meta.snapshotId : "";
  counters.playlists += 1;
}
