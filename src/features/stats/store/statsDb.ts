import type { PlayRecord } from "../lib/aggregate";

const DB_NAME = "liner_stats_v1";
const DB_VERSION = 1;
const STORE = "plays";
const OWNER_TS_INDEX = "owner_ts";

type Listener = () => void;

/**
 * listening history kept on this device. A separate database from the media cache so clearing
 * the cache in settings never wipes the statistics.
 */
class StatsDb {
  private dbPromise: Promise<IDBDatabase> | null = null;
  // used when indexeddb is unavailable (tests, broken profile)
  private memory: PlayRecord[] | null = typeof indexedDB === "undefined" ? [] : null;
  private listeners = new Set<Listener>();

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex(OWNER_TS_INDEX, ["owner", "ts"], { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        db.onclose = () => {
          this.dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error);
      };
      request.onblocked = () => {
        this.dbPromise = null;
        reject(new Error("stats db blocked"));
      };
    });
    return this.dbPromise;
  }

  private useMemory(): PlayRecord[] {
    if (!this.memory) this.memory = [];
    return this.memory;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  async putMany(records: readonly PlayRecord[]): Promise<void> {
    if (records.length === 0) return;
    if (this.memory) {
      const byId = new Map(this.memory.map((r) => [r.id, r]));
      for (const r of records) byId.set(r.id, r);
      this.memory = Array.from(byId.values());
      this.notify();
      return;
    }
    try {
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const r of records) store.put(r);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("stats tx aborted"));
      });
    } catch {
      // keep the listen for this session at least
      const mem = this.useMemory();
      mem.push(...records);
    }
    this.notify();
  }

  put(record: PlayRecord): Promise<void> {
    return this.putMany([record]);
  }

  /** listens of `owner` with start <= ts < end, oldest first */
  async getRange(owner: string, start: number, end: number): Promise<PlayRecord[]> {
    if (this.memory) {
      return this.memory
        .filter((r) => r.owner === owner && r.ts >= start && r.ts < end)
        .sort((a, b) => a.ts - b.ts);
    }
    try {
      const db = await this.open();
      return await new Promise<PlayRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const index = tx.objectStore(STORE).index(OWNER_TS_INDEX);
        const req = index.getAll(IDBKeyRange.bound([owner, start], [owner, end], false, true));
        req.onsuccess = () => resolve(req.result as PlayRecord[]);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  /** timestamp of the oldest listen of `owner`, or null without any */
  async getEarliest(owner: string): Promise<number | null> {
    if (this.memory) {
      let min: number | null = null;
      for (const r of this.memory) {
        if (r.owner === owner && (min === null || r.ts < min)) min = r.ts;
      }
      return min;
    }
    try {
      const db = await this.open();
      return await new Promise<number | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const index = tx.objectStore(STORE).index(OWNER_TS_INDEX);
        const req = index.openCursor(IDBKeyRange.bound([owner, -Infinity], [owner, Infinity]));
        req.onsuccess = () => resolve(req.result ? (req.result.value as PlayRecord).ts : null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  /** test helper */
  resetForTests() {
    this.memory = [];
    this.listeners.clear();
  }
}

export const statsDb = new StatsDb();
