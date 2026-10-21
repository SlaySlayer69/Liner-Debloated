import { api, mediaUrl, toClientTrack } from "@/shared/api";
import { queryCache } from "@/shared/cache/queryCache";
import type { Track } from "@/shared/types";
import type { CollectionRadioKind } from "./collectionRadio";

/**
 * the songs of a playlist, album or artist (top songs) for the collection radio; pages that
 * were opened already are served from their cache instead of asking the server again
 */
export async function loadCollectionTracks(
  kind: CollectionRadioKind,
  id: string,
  ownedPlaylist = false,
): Promise<Track[]> {
  if (kind === "artist") {
    const artist = await api.getArtist(id);
    return (artist.tracks || []).map(toClientTrack);
  }

  if (kind === "playlist" && ownedPlaylist) {
    const cached = queryCache.get<{ tracks: Track[] }>(`playlist:detail:${id}`);
    if (cached?.tracks?.length) return cached.tracks;
    const res = await api.getUserPlaylist(id);
    return (res.items || []).map((item) => toClientTrack(item.track));
  }

  const cached = queryCache.get<{ tracks: Track[] }>(`collection:${kind}:${id}`);
  if (cached?.tracks?.length) return cached.tracks;

  const collection = kind === "album" ? await api.getAlbum(id) : await api.getPlaylist(id);
  // some playlist ids resolve to a user playlist ({ playlist, items }) instead of a catalog one
  const userItems = (collection as unknown as { items?: { track: unknown }[] }).items;
  if (Array.isArray(userItems)) return userItems.map((item) => toClientTrack(item.track));
  // album tracks often come without artwork of their own
  const cover = collection.cover?.url ? mediaUrl(collection.cover.url) : "";
  return (collection.tracks || []).map((raw) => {
    const track = toClientTrack(raw);
    return track.coverUrl || !cover ? track : { ...track, coverUrl: cover };
  });
}
