export {
  createSpotifyClient,
  SpotifyApiError,
  type SpotifyPlaylist,
  type SpotifyProfile,
} from "./api/spotifyClient";
export { useSpotifyAccount } from "./hooks/useSpotifyAccount";
export { useSpotifySync } from "./hooks/useSpotifySync";
export {
  SYNC_INTERVAL_OPTIONS,
  useSpotifySyncStore,
} from "./store/spotifySyncStore";
export { syncSpotifyNow } from "./sync/controller";
export { isReadablePlaylist } from "./sync/syncEngine";
export type { PlaylistSyncMode, SyncResult } from "./sync/types";

/** must match the redirect uri registered in the user's spotify app (electron/spotify/pkce.ts) */
export const SPOTIFY_REDIRECT_URI = "http://127.0.0.1:43821/callback";
export {
  resolveSpotifyLink,
  publicSpotifySource,
  UnsupportedLinkError,
} from "./links/publicSource";
export type { LinkedSource } from "./sync/types";
