import type { Track } from "@/shared/contracts";
import type { SpotifyTrack } from "../api/spotifyClient";
import {
  MATCH_CONCURRENCY,
  cachedLookup,
  mapLimited,
  mirrorPlaylist,
  mirrorSet,
  type Counters,
  type LinerTarget,
} from "../sync/syncEngine";
import type { LinkedSource, SyncLedger } from "../sync/types";
import {
  importedToSpotifyTrack,
  publicAlbumToSpotifyAlbum,
  trackListFingerprint,
  type PublicSpotifySource,
} from "./publicSource";

export const LINK_KEY_PREFIX = "link:";

export interface LinkSyncContext {
  source: PublicSpotifySource;
  liner: LinerTarget;
  ledger: SyncLedger;
  links: LinkedSource[];
  counters: Counters;
  force: boolean;
  now: number;
  trackMatch: (track: SpotifyTrack) => Promise<Track | null>;
  /** runs one part on its own, so a failing link does not stop the others */
  attempt: (work: () => Promise<void>) => Promise<void>;
  onProgress?: (step: string) => void;
  commit: () => void;
}

/** mirrors the linked public playlists and albums; returns whether anything was looked at */
export async function syncLinkedSources(
  ctx: LinkSyncContext,
): Promise<boolean> {
  const { ledger, links, counters } = ctx;
  let worked = false;

  const playlistLinks = links.filter((link) => link.kind === "playlist");
  const linkedKeys = new Set(
    playlistLinks.map((link) => LINK_KEY_PREFIX + link.id),
  );
  // an unlinked playlist keeps its liner copy; the sync just stops following it
  for (const key of Object.keys(ledger.playlists)) {
    if (key.startsWith(LINK_KEY_PREFIX) && !linkedKeys.has(key))
      delete ledger.playlists[key];
  }

  for (const link of playlistLinks) {
    await ctx.attempt(async () => {
      const item = await ctx.source.read("playlist", link.id);
      const key = LINK_KEY_PREFIX + link.id;
      const fingerprint = trackListFingerprint(item.tracks);
      if (!ctx.force && ledger.playlists[key]?.snapshotId === fingerprint)
        return;
      worked = true;
      const name = item.title || link.title;
      ctx.onProgress?.(`playlist:${name}`);
      const matched = await mapLimited(
        item.tracks.map(importedToSpotifyTrack),
        MATCH_CONCURRENCY,
        ctx.trackMatch,
      );
      await mirrorPlaylist(
        ctx.liner,
        ledger,
        key,
        {
          name,
          description: item.description,
          snapshotId: fingerprint,
        },
        matched,
        counters,
        item.complete,
      );
      ctx.commit();
    });
  }

  const albumLinks = links.filter((link) => link.kind === "album");
  if (albumLinks.length === 0 && Object.keys(ledger.linkAlbums).length === 0)
    return worked;

  await ctx.attempt(async () => {
    const known = new Set(Object.keys(ledger.linkAlbums));
    const changed =
      albumLinks.length !== known.size ||
      albumLinks.some((link) => !known.has(link.id));
    if (!ctx.force && !changed) return;
    worked = true;
    ctx.onProgress?.("albums");
    const match = cachedLookup<
      { id: string },
      { id: string; snapshot: Record<string, unknown> }
    >(
      ledger.albumMatches,
      async (album) =>
        ctx.liner.matchAlbum(
          publicAlbumToSpotifyAlbum(await ctx.source.read("album", album.id)),
        ),
      ctx.now,
    );
    await mirrorSet<{ id: string }>({
      source: albumLinks.map((link) => ({ id: link.id })),
      entries: ledger.linkAlbums,
      match: async (album) => (await match(album))?.id ?? null,
      present: await ctx.liner.savedCollectionIds("albums"),
      add: async (album) => {
        const snapshot = ledger.albumMatches[album.id]?.value;
        if (snapshot) await ctx.liner.saveCollection("albums", snapshot);
      },
      remove: (id) => ctx.liner.removeCollection("albums", id),
      counters,
    });
    ctx.commit();
  });
  return worked;
}
