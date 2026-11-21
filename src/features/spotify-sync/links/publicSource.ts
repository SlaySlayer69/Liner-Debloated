import type { ImportedTrack } from "@/shared/contracts";
import { fetchSpotifyEmbed } from "@/features/library/services/import/sources/spotify/spotifyEmbed";
import { fetchSpotifyPlaylistTracks } from "@/features/library/services/import/sources/spotify/spotifyPathfinder";
import {
  parseSpotifyUrl,
  resolveSpotifyUrl,
} from "@/features/library/services/import/sources/spotify/spotifyUrl";
import type { SpotifyAlbum, SpotifyTrack } from "../api/spotifyClient";

// reads public spotify playlists and albums the same way the playlist import does
// (anonymous web player token, embed page as fallback): no spotify account needed

export type LinkKind = "playlist" | "album";

export interface PublicSpotifyItem {
  kind: LinkKind;
  id: string;
  title: string;
  description?: string;
  tracks: ImportedTrack[];
  /** false when only part of the list could be read; then nothing is removed */
  complete: boolean;
}

export interface PublicSpotifySource {
  read(kind: LinkKind, id: string): Promise<PublicSpotifyItem>;
}

// the embed page lists at most this many songs
const EMBED_LIMIT = 100;

export class UnsupportedLinkError extends Error {
  constructor() {
    super("unsupported_link");
  }
}

/** playlist or album id behind a spotify link (short links are followed) */
export async function resolveSpotifyLink(
  rawUrl: string,
): Promise<{ kind: LinkKind; id: string }> {
  let parsed: { type: string; id: string };
  try {
    parsed = parseSpotifyUrl(await resolveSpotifyUrl(rawUrl));
  } catch {
    throw new UnsupportedLinkError();
  }
  if (parsed.type !== "playlist" && parsed.type !== "album")
    throw new UnsupportedLinkError();
  return { kind: parsed.type, id: parsed.id };
}

export const publicSpotifySource: PublicSpotifySource = {
  async read(kind, id) {
    const embed = await fetchSpotifyEmbed(kind, id, "Spotify");
    const title = embed.title ?? "";
    const base = {
      kind,
      id,
      title,
      ...(embed.description ? { description: embed.description } : {}),
    };
    if (kind === "playlist") {
      try {
        const full = await fetchSpotifyPlaylistTracks(id);
        if (full.tracks.length > 0 || full.complete)
          return {
            ...base,
            tracks: full.tracks,
            complete: Boolean(full.complete),
          };
      } catch {
        // fall back to the embed page below
      }
    }
    if (embed.tracks.length === 0) throw new Error("public_link_empty");
    return {
      ...base,
      tracks: embed.tracks,
      complete: embed.tracks.length < EMBED_LIMIT,
    };
  },
};

/** the shape the matcher and the match cache use for api tracks */
export function importedToSpotifyTrack(track: ImportedTrack): SpotifyTrack {
  return {
    id: track.sourceId,
    name: track.title,
    artists: track.artists.map((name) => ({ id: null, name })),
    ...(track.album
      ? {
          album: {
            id: null,
            name: track.album,
            ...(track.coverUrl ? { images: [{ url: track.coverUrl }] } : {}),
          },
        }
      : {}),
    duration_ms: track.durationMs ?? 0,
  };
}

export function publicAlbumToSpotifyAlbum(
  item: PublicSpotifyItem,
): SpotifyAlbum {
  const artist = item.tracks[0]?.artists[0];
  return {
    id: item.id,
    name: item.title,
    artists: artist ? [{ id: null, name: artist }] : [],
    total_tracks: item.tracks.length,
  };
}

/** changes whenever a song is added, removed or moved */
export function trackListFingerprint(tracks: ImportedTrack[]): string {
  let hash = 5381;
  const joined = tracks.map((track) => track.sourceId).join(",");
  for (let i = 0; i < joined.length; i++)
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
  return `${tracks.length}:${(hash >>> 0).toString(36)}`;
}
