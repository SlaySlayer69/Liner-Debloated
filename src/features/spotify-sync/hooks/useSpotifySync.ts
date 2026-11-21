import { useEffect, useSyncExternalStore } from "react";
import { useSessionOwner } from "@/features/home/hooks/sessionAwareLoad";
import { useSpotifySyncStore } from "../store/spotifySyncStore";
import { isSpotifySyncAvailable, syncSpotifyNow } from "../sync/controller";
import {
  refreshSpotifyAccount,
  spotifyAccountSnapshot,
  subscribeSpotifyAccount,
} from "./useSpotifyAccount";

// give the app time to settle after start before the first check
const FIRST_CHECK_DELAY_MS = 20_000;

const connectedSnapshot = () => spotifyAccountSnapshot().connected;

/** checks spotify for changes every few minutes while the app runs (main window only) */
export function useSpotifySync() {
  const owner = useSessionOwner();
  const connected = useSyncExternalStore(
    subscribeSpotifyAccount,
    connectedSnapshot,
  );
  const autoSync = useSpotifySyncStore((s) => s.settings.autoSync);
  const hasLinks = useSpotifySyncStore(
    (s) => s.settings.linkedSources.length > 0,
  );
  const intervalMinutes = useSpotifySyncStore(
    (s) => s.settings.intervalMinutes,
  );

  useEffect(() => {
    if (isSpotifySyncAvailable()) void refreshSpotifyAccount();
  }, []);

  useEffect(() => {
    if (!owner || (!connected && !hasLinks) || !autoSync) return;
    const tick = () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      void syncSpotifyNow();
    };
    const first = window.setTimeout(tick, FIRST_CHECK_DELAY_MS);
    const every = window.setInterval(
      tick,
      Math.max(1, intervalMinutes) * 60_000,
    );
    window.addEventListener("online", tick);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.removeEventListener("online", tick);
    };
  }, [owner, connected, hasLinks, autoSync, intervalMinutes]);
}
