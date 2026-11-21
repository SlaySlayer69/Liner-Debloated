import { api, ApiError } from "@/shared/api";
import type { SearchResult, Track } from "@/shared/contracts";
import {
  artistsMatch,
  cleanTitle,
  findCatalogMatch,
} from "@/shared/media/matching";
import {
  likedTracksSnapshot,
  loadLikedTracks,
  setTrackLiked,
} from "@/features/library/hooks/useLikedTracks";
import type {
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyImage,
  SpotifyTrack,
} from "../api/spotifyClient";
import { LinerPlaylistMissingError, type LinerTarget } from "./syncEngine";

const ADD_FALLBACK_CONCURRENCY = 4;

function largestImage(images?: SpotifyImage[] | null): string | undefined {
  if (!images?.length) return undefined;
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
}

const sameTitle = (left: string, right: string) => {
  const a = cleanTitle(left).toLowerCase();
  const b = cleanTitle(right).toLowerCase();
  return a.length > 0 && a === b;
};

const isMissing = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 410);

async function matchTrack(track: SpotifyTrack): Promise<Track | null> {
  const outcome = await findCatalogMatch({
    sourceId: `spotify:${track.id}`,
    title: track.name,
    artists: track.artists.map((artist) => artist.name).filter(Boolean),
    ...(track.album?.name ? { album: track.album.name } : {}),
    ...(track.duration_ms ? { durationMs: track.duration_ms } : {}),
    ...(largestImage(track.album?.images)
      ? { coverUrl: largestImage(track.album?.images) }
      : {}),
  });
  return outcome.status === "approved" ? outcome.track : null;
}

async function matchAlbum(album: SpotifyAlbum) {
  const artist = album.artists[0]?.name ?? "";
  const { items } = await api.search(`${album.name} ${artist}`.trim(), "album");
  const hit = items.find(
    (item): item is Extract<SearchResult, { type: "album" }> =>
      item.type === "album" &&
      sameTitle(item.title, album.name) &&
      (!artist ||
        item.artists.some((candidate) => artistsMatch(artist, candidate.name))),
  );
  if (!hit) return null;
  return {
    id: hit.id,
    snapshot: {
      id: hit.id,
      title: hit.title,
      ...(hit.cover ? { cover: { url: hit.cover.url } } : {}),
      ...(album.total_tracks ? { trackCount: album.total_tracks } : {}),
    },
  };
}

async function matchArtist(artist: SpotifyArtist) {
  const { items } = await api.search(artist.name, "artist");
  const hit = items.find(
    (item): item is Extract<SearchResult, { type: "artist" }> =>
      item.type === "artist" && artistsMatch(artist.name, item.name),
  );
  if (!hit) return null;
  return {
    id: hit.id,
    snapshot: {
      id: hit.id,
      name: hit.name,
      title: hit.name,
      ...(hit.cover ? { cover: { url: hit.cover.url } } : {}),
    },
  };
}

async function addPlaylistTracks(
  playlistId: string,
  tracks: Track[],
): Promise<Record<string, string>> {
  const added: Record<string, string> = {};
  try {
    const result = await api.addPlaylistTrackSnapshots(playlistId, tracks);
    for (const item of result.items) added[item.track.id] = item.id;
    return added;
  } catch (error) {
    if (error instanceof ApiError && error.status === 410)
      throw new LinerPlaylistMissingError();
    // 404 / 405: a server without the batch endpoint, fall back below
    if (
      !(error instanceof ApiError) ||
      (error.status !== 404 && error.status !== 405)
    )
      throw error;
  }
  // older servers only take one track per request
  let cursor = 0;
  const worker = async () => {
    while (cursor < tracks.length) {
      const track = tracks[cursor++];
      try {
        const item = await api.addPlaylistTrack(playlistId, track.id, track);
        added[track.id] = item.id;
      } catch (error) {
        if (isMissing(error)) throw new LinerPlaylistMissingError();
        // 409: already in the playlist; anything else is retried on the next change
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(ADD_FALLBACK_CONCURRENCY, tracks.length) },
      worker,
    ),
  );
  return added;
}

export const linerTarget: LinerTarget = {
  matchTrack,
  matchAlbum,
  matchArtist,

  async likedTrackIds() {
    await loadLikedTracks(true);
    const liked = likedTracksSnapshot();
    // without the real list every existing like would look like one the sync made,
    // and could later be removed again: better skip this run
    if (!liked.fromServer) throw new Error("liked_tracks_unavailable");
    return new Set(liked.tracks.map((track) => track.id));
  },
  setLiked: (trackId, liked) => setTrackLiked(trackId, liked),

  async savedCollectionIds(type) {
    const { items } = await api.listSavedCollections(type);
    const key = type === "albums" ? "album" : "artist";
    return new Set(
      items
        .map(
          (entry) =>
            (entry as Record<string, { id?: string } | undefined>)[key]?.id,
        )
        .filter((id): id is string => Boolean(id)),
    );
  },
  saveCollection: (type, item) =>
    api.saveCollection(type, item.id, item.snapshot),
  removeCollection: (type, id) => api.removeCollection(type, id),

  async createPlaylist(title, description) {
    const playlist = await api.createPlaylist({
      title: title.trim().slice(0, 200) || "Spotify",
      ...(description ? { description: description.slice(0, 2000) } : {}),
    });
    return playlist.id;
  },
  async hasPlaylist(playlistId) {
    try {
      await api.readUserPlaylist(playlistId, { limit: 1 });
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  },
  addPlaylistTracks,
  async removePlaylistItem(playlistId, itemId) {
    try {
      await api.removePlaylistItem(playlistId, itemId);
    } catch (error) {
      if (!isMissing(error)) throw error;
      // the item is gone already; only a missing playlist matters to the engine
      if (!(await linerTarget.hasPlaylist(playlistId)))
        throw new LinerPlaylistMissingError();
    }
  },
};
