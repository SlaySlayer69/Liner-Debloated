import type { GlobalShortcut } from "electron";
import { normalizeShortcut } from "./accelerator";

type ShortcutRegistry = Pick<GlobalShortcut, "register" | "unregister">;

export interface AppGlobalShortcut {
  action: string;
  accelerator: string;
}

export interface AppGlobalShortcutResult {
  action: string;
  ok: boolean;
}

// actions that only make sense with the window on screen bring it to the front first
const WINDOW_ACTIONS = new Set(["search", "toggleQueue", "toggleLyrics", "toggleFullscreen"]);

export function needsWindow(action: string): boolean {
  return WINDOW_ACTIONS.has(action);
}

/**
 * main-app shortcuts the user switched to "global": they keep working while another
 * application has focus. Each press is forwarded to the renderer, which runs the action.
 */
export function createAppGlobalShortcuts(
  registry: ShortcutRegistry,
  onTrigger: (action: string) => void,
) {
  let wanted: AppGlobalShortcut[] = [];
  let registered: string[] = [];
  let paused = false;

  const unregisterAll = () => {
    for (const accelerator of registered) {
      try {
        registry.unregister(accelerator);
      } catch {}
    }
    registered = [];
  };

  const registerAll = (): AppGlobalShortcutResult[] => {
    unregisterAll();
    const results: AppGlobalShortcutResult[] = [];
    const taken = new Set<string>();
    for (const { action, accelerator } of wanted) {
      const normalized = normalizeShortcut(accelerator);
      if (!normalized || taken.has(normalized.toLowerCase())) {
        results.push({ action, ok: false });
        continue;
      }
      let ok = false;
      try {
        // false when another application already owns the combination
        ok = registry.register(normalized, () => onTrigger(action));
      } catch {
        ok = false;
      }
      if (ok) {
        registered.push(normalized);
        taken.add(normalized.toLowerCase());
      }
      results.push({ action, ok });
    }
    return results;
  };

  return {
    set(next: AppGlobalShortcut[]): AppGlobalShortcutResult[] {
      wanted = next.filter((s) => s && typeof s.action === "string" && typeof s.accelerator === "string");
      if (paused) return wanted.map(({ action }) => ({ action, ok: true }));
      return registerAll();
    },
    // while a shortcut is being recorded the keys must reach the settings window
    pause(next: boolean) {
      if (next === paused) return;
      paused = next;
      if (paused) unregisterAll();
      else registerAll();
    },
    dispose() {
      unregisterAll();
      wanted = [];
    },
  };
}
