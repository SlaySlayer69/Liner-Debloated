import { useEffect, useRef } from "react";
import { playerEngine, usePlayerStore, toVolumeGain, toVolumeLevel } from "@/features/player";
import {
  useShortcutsStore,
  matchesShortcut,
  type MainAppShortcutAction,
} from "@/features/shortcuts";
import {
  isBlockingOverlayOpen,
  isKeyHandledByFocusedControl,
  isTypingTarget,
} from "../utils/shortcutGuards";

const VOLUME_STEP = 0.05;
const SEEK_STEP_MS = 5_000;
const DEFAULT_UNMUTE_LEVEL = 0.7;

function roundToPercent(level: number): number {
  return Math.round(level * 100) / 100;
}

const REPEATABLE_CODES = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

export type RightPanelTab = "queue" | "lyrics";

export interface GlobalShortcutsOptions {
  enabled?: boolean;
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  openRightPanel: (tab: RightPanelTab) => void;
  closeRightPanel: () => void;
  fullscreenOpen: boolean;
  openFullscreen: () => void;
  closeFullscreen: () => void;
  onEscapeFallback?: () => boolean;
}

// checked in this order, so a more specific combination wins over a plain key
const ACTION_ORDER: readonly MainAppShortcutAction[] = [
  "playPause",
  "nextTrack",
  "prevTrack",
  "toggleFullscreen",
  "toggleQueue",
  "toggleLyrics",
  "toggleMute",
  "search",
  "seekBackward",
  "seekForward",
  "volumeUp",
  "volumeDown",
];

function runAction(
  action: MainAppShortcutAction,
  opts: GlobalShortcutsOptions,
  lastUnmutedLevelRef: { current: number },
): void {
  switch (action) {
    case "playPause":
      playerEngine.togglePlayPause();
      return;
    case "nextTrack":
      void playerEngine.skipNext();
      return;
    case "prevTrack":
      void playerEngine.skipPrevious();
      return;
    case "toggleFullscreen":
      if (opts.fullscreenOpen) {
        opts.closeFullscreen();
      } else {
        const { currentTrack, status } = usePlayerStore.getState();
        if (currentTrack !== null && status !== "idle") {
          opts.openFullscreen();
        }
      }
      return;
    case "toggleQueue":
      if (opts.rightPanelOpen && opts.rightPanelTab === "queue") opts.closeRightPanel();
      else opts.openRightPanel("queue");
      return;
    case "toggleLyrics":
      if (opts.rightPanelOpen && opts.rightPanelTab === "lyrics") opts.closeRightPanel();
      else opts.openRightPanel("lyrics");
      return;
    case "toggleMute": {
      const level = toVolumeLevel(usePlayerStore.getState().volume);
      if (level > 0) {
        lastUnmutedLevelRef.current = level;
        playerEngine.setVolume(0);
      } else {
        playerEngine.setVolume(
          toVolumeGain(lastUnmutedLevelRef.current || DEFAULT_UNMUTE_LEVEL),
        );
      }
      return;
    }
    case "search":
      opts.openSearch();
      return;
    case "seekBackward": {
      const { positionMs } = usePlayerStore.getState();
      playerEngine.seek(Math.max(0, positionMs - SEEK_STEP_MS));
      return;
    }
    case "seekForward": {
      const { positionMs, durationMs } = usePlayerStore.getState();
      const upperBound = durationMs > 0 ? durationMs : positionMs + SEEK_STEP_MS;
      playerEngine.seek(Math.min(upperBound, positionMs + SEEK_STEP_MS));
      return;
    }
    case "volumeUp": {
      const level = toVolumeLevel(usePlayerStore.getState().volume);
      const nextLevel = roundToPercent(Math.min(1, level + VOLUME_STEP));
      playerEngine.setVolume(toVolumeGain(nextLevel));
      if (nextLevel > 0) lastUnmutedLevelRef.current = nextLevel;
      return;
    }
    case "volumeDown": {
      const level = toVolumeLevel(usePlayerStore.getState().volume);
      const nextLevel = roundToPercent(Math.max(0, level - VOLUME_STEP));
      playerEngine.setVolume(toVolumeGain(nextLevel));
      if (nextLevel > 0) lastUnmutedLevelRef.current = nextLevel;
      return;
    }
  }
}

export function useGlobalShortcuts(options: GlobalShortcutsOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const lastUnmutedLevelRef = useRef(DEFAULT_UNMUTE_LEVEL);

  // shortcuts made global in settings arrive from the main process, focused or not
  useEffect(() => {
    const subscribe = typeof window !== "undefined" ? window.linerElectron?.onAppGlobalShortcut : undefined;
    if (!subscribe) return;
    return subscribe((action) => {
      const opts = optionsRef.current;
      if (opts.enabled === false) return;
      if (useShortcutsStore.getState().isRecording) return;
      if (!(ACTION_ORDER as readonly string[]).includes(action)) return;
      runAction(action as MainAppShortcutAction, opts, lastUnmutedLevelRef);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const opts = optionsRef.current;
      if (opts.enabled === false) return;
      if (event.defaultPrevented) return;
      if (useShortcutsStore.getState().isRecording) return;

      // ignore shortcuts if window does not have focus
      if (
        typeof document !== "undefined" &&
        typeof document.hasFocus === "function" &&
        process.env.NODE_ENV !== "test" &&
        !document.hasFocus()
      ) {
        return;
      }

      const { code } = event;
      if (event.repeat && !REPEATABLE_CODES.has(code)) return;

      if (code === "Escape" || event.key === "Escape") {
        if (isBlockingOverlayOpen()) return;
        if (opts.searchOpen) {
          event.preventDefault();
          event.stopPropagation();
          opts.closeSearch();
          return;
        }
        if (opts.rightPanelOpen) {
          event.preventDefault();
          event.stopPropagation();
          opts.closeRightPanel();
          return;
        }
        if (opts.fullscreenOpen) {
          event.preventDefault();
          event.stopPropagation();
          opts.closeFullscreen();
          return;
        }
        if (opts.onEscapeFallback?.()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (isTypingTarget(event.target)) return;
      if (isBlockingOverlayOpen()) return;
      if (isKeyHandledByFocusedControl(event.target, code)) return;

      const { mainApp, mainAppGlobalStatus } = useShortcutsStore.getState();

      for (const action of ACTION_ORDER) {
        if (!matchesShortcut(event, mainApp[action])) continue;
        event.preventDefault();
        // a registered global shortcut already fires through the main process
        if (mainAppGlobalStatus[action]) return;
        runAction(action, opts, lastUnmutedLevelRef);
        return;
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
