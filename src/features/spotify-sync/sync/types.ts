import type { Track } from "@/shared/contracts";

export type PlaylistSyncMode = "none" | "all" | "selected";

export interface SpotifySyncSettings {
  /** the client id of the user's own spotify developer app */
  clientId: string;
  /** check spotify for changes in the background */
  autoSync: boolean;
  liked: boolean;
  albums: boolean;
  artists: boolean;
  playlistsMode: PlaylistSyncMode;
  selectedPlaylists: string[];
  intervalMinutes: number;
}

export interface CollectionSnapshot {
  id: string;
  snapshot: Record<string, unknown>;
}

/** what the sync itself put into liner, so it only ever removes its own additions */
export interface SyncedEntry {
  linerId: string;
  /** already in the liner library before the sync saw it: never removed by the sync */
  own: boolean;
}

export interface SyncedPlaylist {
  linerId: string;
  name: string;
  snapshotId: string;
  /** liner track id -> playlist item id, for the tracks the sync added */
  items: Record<string, string>;
}

export interface CachedMatch<T> {
  value: T | null;
  at: number;
}

export interface SyncLedger {
  /** the liner account the ledger belongs to */
  owner: string | null;
  playlists: Record<string, SyncedPlaylist>;
  liked: Record<string, SyncedEntry>;
  albums: Record<string, SyncedEntry>;
  artists: Record<string, SyncedEntry>;
  fingerprints: Partial<Record<"liked" | "albums" | "artists", string>>;
  trackMatches: Record<string, CachedMatch<Track>>;
  albumMatches: Record<string, CachedMatch<CollectionSnapshot>>;
  artistMatches: Record<string, CachedMatch<CollectionSnapshot>>;
}

export interface SyncResult {
  finishedAt: number;
  added: number;
  removed: number;
  unmatched: number;
  playlists: number;
  skipped: boolean;
  error?: string;
}

export const emptyLedger = (owner: string | null = null): SyncLedger => ({
  owner,
  playlists: {},
  liked: {},
  albums: {},
  artists: {},
  fingerprints: {},
  trackMatches: {},
  albumMatches: {},
  artistMatches: {},
});
