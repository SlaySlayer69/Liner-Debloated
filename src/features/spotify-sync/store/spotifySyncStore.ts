import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  emptyLedger,
  type SpotifySyncSettings,
  type SyncLedger,
  type SyncResult,
} from "../sync/types";

export const SYNC_INTERVAL_OPTIONS = [2, 5, 10, 15, 30, 60] as const;

const DEFAULT_SETTINGS: SpotifySyncSettings = {
  clientId:
    (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) ?? "",
  autoSync: true,
  liked: true,
  albums: true,
  artists: true,
  playlistsMode: "selected",
  selectedPlaylists: [],
  intervalMinutes: 5,
};

interface SpotifySyncState {
  settings: SpotifySyncSettings;
  ledger: SyncLedger;
  lastResult: SyncResult | null;
  /** not persisted: what the running sync is doing right now */
  running: boolean;
  progress: string | null;

  updateSettings: (patch: Partial<SpotifySyncSettings>) => void;
  togglePlaylist: (id: string, selected: boolean) => void;
  setLedger: (ledger: SyncLedger) => void;
  /** forget what was synced (sign-out, other liner account); keeps the settings */
  resetLedger: (owner?: string | null) => void;
  setRunning: (running: boolean, progress?: string | null) => void;
  setLastResult: (result: SyncResult) => void;
}

export const useSpotifySyncStore = create<SpotifySyncState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      ledger: emptyLedger(),
      lastResult: null,
      running: false,
      progress: null,

      updateSettings: (patch) =>
        set({ settings: { ...get().settings, ...patch } }),
      togglePlaylist: (id, selected) => {
        const current = new Set(get().settings.selectedPlaylists);
        if (selected) current.add(id);
        else current.delete(id);
        set({
          settings: { ...get().settings, selectedPlaylists: [...current] },
        });
      },
      setLedger: (ledger) => set({ ledger }),
      resetLedger: (owner = null) =>
        set({ ledger: emptyLedger(owner), lastResult: null }),
      setRunning: (running, progress = null) => set({ running, progress }),
      setLastResult: (lastResult) => set({ lastResult }),
    }),
    {
      name: "liner-spotify-sync",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settings: state.settings,
        ledger: state.ledger,
        lastResult: state.lastResult,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SpotifySyncState>;
        return {
          ...current,
          ...saved,
          settings: { ...DEFAULT_SETTINGS, ...saved.settings },
          ledger: { ...emptyLedger(), ...saved.ledger },
        };
      },
    },
  ),
);
