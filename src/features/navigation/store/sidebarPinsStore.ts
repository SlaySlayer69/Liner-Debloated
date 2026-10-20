import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type SidebarPinKind = "playlist" | "album" | "artist";

export interface SidebarPin {
  kind: SidebarPinKind;
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  href: string;
}

export function sidebarPinKey(kind: SidebarPinKind, id: string): string {
  return `${kind}:${id}`;
}

/** route that opens a pinned item; user playlists live in the library, catalog ones in collections */
export function sidebarPinHref(kind: SidebarPinKind, id: string, ownedPlaylist = false): string {
  const encoded = encodeURIComponent(id);
  if (kind === "artist") return `/artist?id=${encoded}`;
  if (kind === "album") return `/collection?type=album&id=${encoded}`;
  return ownedPlaylist ? `/library/playlist?id=${encoded}` : `/collection?type=playlist&id=${encoded}`;
}

interface SidebarPinsState {
  pins: SidebarPin[];
  pin: (item: SidebarPin) => void;
  unpin: (kind: SidebarPinKind, id: string) => void;
  toggle: (item: SidebarPin) => boolean;
  move: (fromIndex: number, toIndex: number) => void;
}

export const useSidebarPinsStore = create<SidebarPinsState>()(
  persist(
    (set, get) => ({
      pins: [],

      pin: (item) => {
        const key = sidebarPinKey(item.kind, item.id);
        const existing = get().pins.findIndex((p) => sidebarPinKey(p.kind, p.id) === key);
        if (existing >= 0) {
          // refresh title / artwork in place, keep the user's order
          const next = get().pins.slice();
          next[existing] = { ...next[existing], ...item };
          set({ pins: next });
          return;
        }
        set({ pins: [...get().pins, item] });
      },

      unpin: (kind, id) => {
        const key = sidebarPinKey(kind, id);
        set({ pins: get().pins.filter((p) => sidebarPinKey(p.kind, p.id) !== key) });
      },

      toggle: (item) => {
        if (get().pins.some((p) => p.kind === item.kind && p.id === item.id)) {
          get().unpin(item.kind, item.id);
          return false;
        }
        get().pin(item);
        return true;
      },

      move: (fromIndex, toIndex) => {
        const pins = get().pins.slice();
        if (fromIndex < 0 || fromIndex >= pins.length || toIndex < 0 || toIndex >= pins.length) return;
        const [moved] = pins.splice(fromIndex, 1);
        pins.splice(toIndex, 0, moved);
        set({ pins });
      },
    }),
    {
      name: "liner_sidebar_pins_v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ pins: state.pins }),
    },
  ),
);

export function useIsSidebarPinned(kind: SidebarPinKind | undefined, id: string | undefined): boolean {
  return useSidebarPinsStore((s) =>
    Boolean(kind && id && s.pins.some((p) => p.kind === kind && p.id === id)),
  );
}
