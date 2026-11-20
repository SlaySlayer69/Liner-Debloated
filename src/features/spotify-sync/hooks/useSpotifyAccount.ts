import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createSpotifyClient, type SpotifyProfile } from "../api/spotifyClient";
import { useSpotifySyncStore } from "../store/spotifySyncStore";

interface AccountState {
  loading: boolean;
  connected: boolean;
  profile: SpotifyProfile | null;
}

let state: AccountState = { loading: true, connected: false, profile: null };
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: AccountState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function refreshSpotifyAccount(): Promise<void> {
  if (request) return request;
  request = (async () => {
    const status = await window.linerElectron?.spotifyStatus?.();
    if (!status?.connected) {
      emit({ loading: false, connected: false, profile: null });
      return;
    }
    emit({ ...state, connected: true });
    const profile = await createSpotifyClient()
      .me()
      .catch(() => null);
    emit({ loading: false, connected: true, profile });
  })()
    .catch(() => emit({ loading: false, connected: false, profile: null }))
    .finally(() => {
      request = null;
    });
  return request;
}

export function spotifyAccountSnapshot(): AccountState {
  return state;
}

export function subscribeSpotifyAccount(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSpotifyAccount() {
  const account = useSyncExternalStore(
    subscribeSpotifyAccount,
    spotifyAccountSnapshot,
  );

  useEffect(() => {
    void refreshSpotifyAccount();
  }, []);

  const connect = useCallback(async (clientId: string) => {
    const result = await window.linerElectron?.spotifyConnect?.(
      clientId.trim(),
    );
    await refreshSpotifyAccount();
    return result ?? { ok: false as const, error: "unavailable" };
  }, []);

  const disconnect = useCallback(async () => {
    await window.linerElectron?.spotifyDisconnect?.();
    // what was synced belongs to that spotify account
    useSpotifySyncStore.getState().resetLedger();
    await refreshSpotifyAccount();
  }, []);

  return { ...account, connect, disconnect };
}
