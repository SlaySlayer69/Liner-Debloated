import { getAuthSession } from "@/shared/api";
import { notifyLibraryChanged } from "@/features/library/hooks/usePlaylists";
import { createSpotifyClient, SpotifyApiError } from "../api/spotifyClient";
import { useSpotifySyncStore } from "../store/spotifySyncStore";
import { linerTarget } from "./linerTarget";
import { runSpotifySync, syncErrorCode } from "./syncEngine";
import { publicSpotifySource } from "../links/publicSource";
import type { SyncResult } from "./types";

let running: Promise<SyncResult | null> | null = null;

export function isSpotifySyncAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.linerElectron?.spotifyStatus)
  );
}

/** one sync pass; concurrent calls share the running one */
export function syncSpotifyNow(
  options: { force?: boolean } = {},
): Promise<SyncResult | null> {
  if (running) return running;
  const owner = getAuthSession()?.user?.id ?? null;
  if (!owner || !isSpotifySyncAvailable()) return Promise.resolve(null);

  const store = useSpotifySyncStore.getState();
  // a different liner account must not inherit what the last one synced
  if (store.ledger.owner !== owner) store.resetLedger(owner);
  store.setRunning(true);

  running = (async () => {
    // without a sign-in the public links can still be synced
    const status = await window.linerElectron?.spotifyStatus?.();
    const account = Boolean(status?.connected);
    const { settings, ledger } = useSpotifySyncStore.getState();
    if (!account && settings.linkedSources.length === 0) return null;
    return runSpotifySync(
      createSpotifyClient(),
      linerTarget,
      settings,
      ledger,
      {
        force: options.force,
        account,
        publicSource: publicSpotifySource,
        commit: (next) =>
          useSpotifySyncStore.getState().setLedger(structuredClone(next)),
        onProgress: (step) =>
          useSpotifySyncStore.getState().setRunning(true, step),
      },
    );
  })()
    .then((outcome) => {
      if (!outcome) return null;
      const { ledger, result } = outcome;
      const state = useSpotifySyncStore.getState();
      // signed out of liner meanwhile: drop the result instead of mixing accounts
      if ((getAuthSession()?.user?.id ?? null) !== owner) return null;
      state.setLedger(ledger);
      state.setLastResult(result);
      if (!result.skipped) notifyLibraryChanged();
      return result;
    })
    .catch((error: unknown) => {
      const result: SyncResult = {
        finishedAt: Date.now(),
        added: 0,
        removed: 0,
        unmatched: 0,
        playlists: 0,
        skipped: false,
        error: syncErrorCode(error),
        ...(error instanceof SpotifyApiError && error.detail
          ? { errorDetail: error.detail }
          : {}),
      };
      useSpotifySyncStore.getState().setLastResult(result);
      return result;
    })
    .finally(() => {
      running = null;
      useSpotifySyncStore.getState().setRunning(false);
    });
  return running;
}
