import { api, getAuthSession, toClientTrack } from "@/shared/api";
import type { PlaybackHistoryItem } from "@/shared/contracts";
import type { Track } from "@/shared/types";
import type { PlayRecord, PlayRecordArtist } from "./lib/aggregate";
import { statsDb } from "./store/statsDb";

// local recording starts at the epoch; anything older is imported once from the server history
const EPOCH_KEY = "liner_stats_epoch_v1:";
const BACKFILL_KEY = "liner_stats_backfill_v1:";
const BACKFILL_PAGE_SIZE = 100;
const BACKFILL_MAX_PAGES = 50;

export function currentStatsOwner(): string {
  return getAuthSession()?.user?.id ?? "";
}

function readNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function ensureEpoch(owner: string, now = Date.now()): number {
  const existing = readNumber(EPOCH_KEY + owner);
  if (existing !== null) return existing;
  writeNumber(EPOCH_KEY + owner, now);
  return now;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `local:${crypto.randomUUID()}`;
  }
  return `local:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function artistsOf(track: Pick<Track, "artistList" | "artists" | "artistId">): PlayRecordArtist[] {
  if (track.artistList && track.artistList.length > 0) {
    return track.artistList
      .filter((a) => a?.name)
      .map((a) => ({ id: a.id || undefined, name: a.name }));
  }
  return (track.artists || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name, i) => ({ id: i === 0 ? track.artistId || undefined : undefined, name }));
}

export interface ListenInput {
  track: Track | null;
  trackId: string;
  playedMs: number;
  durationMs: number;
  completed: boolean;
}

/** called by the player for every listen it reports to the server */
export function recordListen(input: ListenInput, now = Date.now()): void {
  const owner = currentStatsOwner();
  ensureEpoch(owner, now);
  const track = input.track;
  const record: PlayRecord = {
    id: makeId(),
    owner,
    ts: now,
    trackId: input.trackId,
    title: track?.title || "",
    artists: track ? artistsOf(track) : [],
    albumId: track?.album?.id || undefined,
    albumTitle: track?.album?.title || undefined,
    coverUrl: track?.coverUrl || undefined,
    explicit: track?.explicit,
    durationMs: track?.durationMs || input.durationMs,
    playedMs: Math.max(0, Math.round(input.playedMs)),
    completed: input.completed,
  };
  void statsDb.put(record);
}

export function historyItemToRecord(item: PlaybackHistoryItem, owner: string): PlayRecord | null {
  const ts = Date.parse(item.listenedAt);
  if (!item.track?.id || !Number.isFinite(ts)) return null;
  const track = toClientTrack(item.track);
  return {
    id: `srv:${item.id}`,
    owner,
    ts,
    trackId: track.id,
    title: track.title,
    artists: artistsOf(track),
    albumId: track.album?.id || undefined,
    albumTitle: track.album?.title || undefined,
    coverUrl: track.coverUrl || undefined,
    explicit: track.explicit,
    durationMs: track.durationMs,
    playedMs: Math.max(0, Math.round(item.playedDurationMs || 0)),
    completed: Boolean(item.completed),
  };
}

const backfills = new Map<string, Promise<void>>();

/**
 * imports the server-side history that predates local recording, once per account,
 * so the statistics are not empty on the first day
 */
export function ensureHistoryBackfill(owner = currentStatsOwner()): Promise<void> {
  if (!owner) return Promise.resolve();
  if (readNumber(BACKFILL_KEY + owner) !== null) return Promise.resolve();
  const running = backfills.get(owner);
  if (running) return running;

  const epoch = ensureEpoch(owner);
  const task = (async () => {
    let cursor: string | undefined;
    for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
      const res = await api.getHistory(cursor, BACKFILL_PAGE_SIZE);
      const records: PlayRecord[] = [];
      for (const item of res.items || []) {
        const record = historyItemToRecord(item, owner);
        if (record && record.ts < epoch) records.push(record);
      }
      await statsDb.putMany(records);
      if (!res.nextCursor || (res.items || []).length === 0) break;
      cursor = res.nextCursor;
    }
    writeNumber(BACKFILL_KEY + owner, Date.now());
  })()
    .catch(() => {
      // retried on the next visit
    })
    .finally(() => {
      backfills.delete(owner);
    });

  backfills.set(owner, task);
  return task;
}
