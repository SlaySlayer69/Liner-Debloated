import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * modern: the 0.2.12 shell, logo and library covers in one sidebar panel, pages from the top.
 * classic: the shell before it, logo in a header bar and a full-height icon sidebar.
 */
export type LayoutStyle = "modern" | "classic";

interface LayoutStyleState {
  layout: LayoutStyle;
  setLayout: (layout: LayoutStyle) => void;
}

export const useLayoutStyleStore = create<LayoutStyleState>()(
  persist(
    (set) => ({
      layout: "modern",
      setLayout: (layout) => set({ layout }),
    }),
    {
      name: "liner-layout-style",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export const useIsClassicLayout = () =>
  useLayoutStyleStore((s) => s.layout === "classic");
