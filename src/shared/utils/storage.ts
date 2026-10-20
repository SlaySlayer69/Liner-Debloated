import type { PersistStorage, StorageValue } from "zustand/middleware";

const pendingWrites = new Map<string, string>();
// persisted state kept as objects until the flush, so a store that changes several times
// a second (player position) is serialized once per flush instead of on every change
const pendingValues = new Map<string, unknown>();

function flushPendingWrites() {
  if (typeof localStorage === "undefined") return;
  for (const [name, value] of pendingValues) {
    try {
      pendingWrites.set(name, JSON.stringify(value));
    } catch {}
  }
  pendingValues.clear();
  if (pendingWrites.size === 0) return;
  for (const [name, value] of pendingWrites.entries()) {
    try {
      localStorage.setItem(name, value);
    } catch {}
  }
  pendingWrites.clear();
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

// batches writes into one flush a second after the first pending one, idle otherwise
function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPendingWrites();
  }, 1000);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushPendingWrites);
}

export const debouncedStorage = {
  getItem: (name: string) => {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
    if (pendingValues.has(name)) {
      return JSON.stringify(pendingValues.get(name));
    }
    if (pendingWrites.has(name)) {
      return pendingWrites.get(name)!;
    }
    return localStorage.getItem(name);
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") return;
    pendingValues.delete(name);
    pendingWrites.set(name, value);
    scheduleFlush();
  },
  removeItem: (name: string) => {
    if (typeof window === "undefined") return;
    pendingValues.delete(name);
    pendingWrites.delete(name);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(name);
    }
  },
  flush: flushPendingWrites,
};

/** zustand persist storage on top of debouncedStorage that defers JSON serialization to the flush */
export function createDeferredJSONStorage<S>(): PersistStorage<S> {
  return {
    getItem: (name) => {
      if (pendingValues.has(name)) return pendingValues.get(name) as StorageValue<S>;
      const raw = debouncedStorage.getItem(name);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      if (typeof window === "undefined") return;
      pendingWrites.delete(name);
      pendingValues.set(name, value);
      scheduleFlush();
    },
    removeItem: (name) => {
      debouncedStorage.removeItem(name);
    },
  };
}
