import { describe, it, expect, beforeEach, vi } from "vitest";
import { useShortcutsStore } from "./shortcutsStore";
import { DEFAULT_SHORTCUTS } from "../types";
import { useOverlaySettingsStore } from "@/features/overlay/store/overlaySettingsStore";

describe("shortcutsStore", () => {
  beforeEach(() => {
    useShortcutsStore.getState().resetAll();
  });

  it("initializes with default shortcuts across all sections", () => {
    const state = useShortcutsStore.getState();
    expect(state.global.toggleOverlay).toBe(DEFAULT_SHORTCUTS.global.toggleOverlay);
    expect(state.global.quickLikeSong).toBe(DEFAULT_SHORTCUTS.global.quickLikeSong);
    expect(state.mainApp.playPause).toBe("Space");
    expect(state.mainApp.nextTrack).toBe("Control+Right");
    expect(state.miniplayer.playPause).toBe("Space");
    expect(state.miniplayer.likeTrack).toBe("L");
  });

  it("updates global shortcuts and normalizes them", () => {
    const updateOverlaySettings = vi.fn();
    (window as any).linerElectron = { updateOverlaySettings };

    useShortcutsStore.getState().setGlobalShortcut("quickLikeSong", "Ctrl+Alt+L");
    expect(useShortcutsStore.getState().global.quickLikeSong).toBe("Control+Alt+L");
    expect(updateOverlaySettings).toHaveBeenCalledWith(
      expect.objectContaining({ likeShortcut: "Control+Alt+L" })
    );

    useShortcutsStore.getState().setGlobalShortcut("toggleOverlay", "Alt+Shift+Щ");
    expect(useShortcutsStore.getState().global.toggleOverlay).toBe("Alt+Shift+O");
    expect(useOverlaySettingsStore.getState().shortcut).toBe("Alt+Shift+O");
  });

  it("updates main app and miniplayer shortcuts", () => {
    useShortcutsStore.getState().setMainAppShortcut("playPause", "P");
    expect(useShortcutsStore.getState().mainApp.playPause).toBe("P");

    useShortcutsStore.getState().setMiniplayerShortcut("nextTrack", "N");
    expect(useShortcutsStore.getState().miniplayer.nextTrack).toBe("N");
  });

  it("resets individual shortcuts to default", () => {
    useShortcutsStore.getState().setMainAppShortcut("playPause", "P");
    expect(useShortcutsStore.getState().mainApp.playPause).toBe("P");

    useShortcutsStore.getState().resetShortcut("mainApp", "playPause");
    expect(useShortcutsStore.getState().mainApp.playPause).toBe("Space");
  });

  it("resets an entire section to default", () => {
    useShortcutsStore.getState().setMiniplayerShortcut("nextTrack", "N");
    useShortcutsStore.getState().setMiniplayerShortcut("likeTrack", "H");

    useShortcutsStore.getState().resetSection("miniplayer");
    expect(useShortcutsStore.getState().miniplayer.nextTrack).toBe("]");
    expect(useShortcutsStore.getState().miniplayer.likeTrack).toBe("L");
  });

  it("resets all shortcuts to defaults", () => {
    useShortcutsStore.getState().setGlobalShortcut("quickLikeSong", "Alt+Shift+K");
    useShortcutsStore.getState().setMainAppShortcut("toggleMute", "X");
    useShortcutsStore.getState().setMiniplayerShortcut("likeTrack", "Y");

    useShortcutsStore.getState().resetAll();
    expect(useShortcutsStore.getState().global.quickLikeSong).toBe("Alt+Shift+L");
    expect(useShortcutsStore.getState().mainApp.toggleMute).toBe("M");
    expect(useShortcutsStore.getState().miniplayer.likeTrack).toBe("L");
  });

  it("toggles isRecording and notifies Electron to pause global shortcuts", () => {
    const pauseOverlayShortcuts = vi.fn();
    (window as any).linerElectron = { pauseOverlayShortcuts };

    useShortcutsStore.getState().setIsRecording(true);
    expect(useShortcutsStore.getState().isRecording).toBe(true);
    expect(pauseOverlayShortcuts).toHaveBeenCalledWith(true);

    useShortcutsStore.getState().setIsRecording(false);
    expect(useShortcutsStore.getState().isRecording).toBe(false);
    expect(pauseOverlayShortcuts).toHaveBeenCalledWith(false);
  });

  describe("global main app shortcuts", () => {
    it("registers flagged actions with electron and records which ones the os accepted", async () => {
      const setAppGlobalShortcuts = vi.fn(async (list: { action: string }[]) =>
        list.map(({ action }) => ({ action, ok: action !== "nextTrack" })),
      );
      (window as any).linerElectron = { setAppGlobalShortcuts };

      expect(useShortcutsStore.getState().setMainAppGlobal("prevTrack", true)).toBe(true);
      expect(useShortcutsStore.getState().setMainAppGlobal("nextTrack", true)).toBe(true);
      expect(setAppGlobalShortcuts).toHaveBeenLastCalledWith([
        { action: "prevTrack", accelerator: "Control+Left" },
        { action: "nextTrack", accelerator: "Control+Right" },
      ]);
      await Promise.resolve();
      await Promise.resolve();
      expect(useShortcutsStore.getState().mainAppGlobalStatus).toEqual({ prevTrack: true, nextTrack: false });

      useShortcutsStore.getState().setMainAppGlobal("prevTrack", false);
      expect(useShortcutsStore.getState().mainAppGlobal).toEqual({ nextTrack: true });
    });

    it("refuses keys without a modifier and drops the flag when one is assigned", () => {
      (window as any).linerElectron = { setAppGlobalShortcuts: vi.fn(async () => []) };

      // Space would swallow typing in every other application
      expect(useShortcutsStore.getState().setMainAppGlobal("playPause", false)).toBe(true);
      expect(useShortcutsStore.getState().setMainAppGlobal("playPause", true)).toBe(false);
      expect(useShortcutsStore.getState().mainAppGlobal.playPause).toBeUndefined();

      useShortcutsStore.getState().setMainAppShortcut("toggleMute", "Alt+M");
      expect(useShortcutsStore.getState().setMainAppGlobal("toggleMute", true)).toBe(true);
      useShortcutsStore.getState().setMainAppShortcut("toggleMute", "M");
      expect(useShortcutsStore.getState().mainAppGlobal.toggleMute).toBeUndefined();

      useShortcutsStore.getState().setMainAppShortcut("search", "F6");
      expect(useShortcutsStore.getState().setMainAppGlobal("search", true)).toBe(true);
    });

    it("clears all global flags on reset", () => {
      (window as any).linerElectron = { setAppGlobalShortcuts: vi.fn(async () => []) };
      useShortcutsStore.getState().setMainAppGlobal("nextTrack", true);
      useShortcutsStore.getState().resetAll();
      expect(useShortcutsStore.getState().mainAppGlobal).toEqual({});
    });

    it("pauses the app's global shortcuts while recording", () => {
      const pauseAppGlobalShortcuts = vi.fn();
      (window as any).linerElectron = { pauseAppGlobalShortcuts };
      useShortcutsStore.getState().setIsRecording(true);
      expect(pauseAppGlobalShortcuts).toHaveBeenCalledWith(true);
      useShortcutsStore.getState().setIsRecording(false);
    });
  });
});
