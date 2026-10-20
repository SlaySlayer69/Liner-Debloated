import { describe, expect, it, vi } from "vitest";
import { createAppGlobalShortcuts, needsWindow } from "./app-shortcuts";

function fakeRegistry(taken: string[] = []) {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    register: vi.fn((accelerator: string, cb: () => void) => {
      if (taken.includes(accelerator) || handlers.has(accelerator)) return false;
      handlers.set(accelerator, cb);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      handlers.delete(accelerator);
    }),
  };
}

describe("createAppGlobalShortcuts", () => {
  it("registers each shortcut and forwards presses as actions", () => {
    const registry = fakeRegistry();
    const onTrigger = vi.fn();
    const shortcuts = createAppGlobalShortcuts(registry, onTrigger);

    const results = shortcuts.set([
      { action: "playPause", accelerator: "Control+Alt+P" },
      { action: "nextTrack", accelerator: "Control+Right" },
    ]);

    expect(results).toEqual([
      { action: "playPause", ok: true },
      { action: "nextTrack", ok: true },
    ]);
    registry.handlers.get("Control+Alt+P")!();
    expect(onTrigger).toHaveBeenCalledWith("playPause");
  });

  it("reports combinations another app owns and duplicates as failed", () => {
    const registry = fakeRegistry(["Control+Alt+P"]);
    const shortcuts = createAppGlobalShortcuts(registry, vi.fn());

    expect(
      shortcuts.set([
        { action: "playPause", accelerator: "Control+Alt+P" },
        { action: "nextTrack", accelerator: "Alt+N" },
        { action: "prevTrack", accelerator: "alt+n" },
      ]),
    ).toEqual([
      { action: "playPause", ok: false },
      { action: "nextTrack", ok: true },
      { action: "prevTrack", ok: false },
    ]);
  });

  it("replaces the previous set and frees everything on dispose", () => {
    const registry = fakeRegistry();
    const shortcuts = createAppGlobalShortcuts(registry, vi.fn());

    shortcuts.set([{ action: "playPause", accelerator: "Alt+P" }]);
    shortcuts.set([{ action: "toggleMute", accelerator: "Alt+M" }]);
    expect([...registry.handlers.keys()]).toEqual(["Alt+M"]);

    shortcuts.dispose();
    expect(registry.handlers.size).toBe(0);
  });

  it("releases the keys while a shortcut is being recorded", () => {
    const registry = fakeRegistry();
    const shortcuts = createAppGlobalShortcuts(registry, vi.fn());
    shortcuts.set([{ action: "playPause", accelerator: "Alt+P" }]);

    shortcuts.pause(true);
    expect(registry.handlers.size).toBe(0);
    // changes while paused are applied on resume
    shortcuts.set([{ action: "volumeUp", accelerator: "Alt+Up" }]);
    expect(registry.handlers.size).toBe(0);

    shortcuts.pause(false);
    expect([...registry.handlers.keys()]).toEqual(["Alt+UP"]);
  });
});

describe("needsWindow", () => {
  it("brings the window up only for actions that show ui", () => {
    expect(needsWindow("search")).toBe(true);
    expect(needsWindow("toggleLyrics")).toBe(true);
    expect(needsWindow("playPause")).toBe(false);
    expect(needsWindow("volumeUp")).toBe(false);
  });
});
