import type { Track } from "@/shared/types";
import type { PeriodBucket } from "./periods";

export interface PlayRecordArtist {
  id?: string;
  name: string;
}

/** one listen, stored locally per account */
export interface PlayRecord {
  id: string;
  owner: string;
  // when the listen was reported (ms epoch)
  ts: number;
  trackId: string;
  title: string;
  artists: PlayRecordArtist[];
  albumId?: string;
  albumTitle?: string;
  coverUrl?: string;
  explicit?: boolean;
  durationMs: number;
  playedMs: number;
  completed: boolean;
}

// a listen counts as a play after 30s or when the track ran to its end
export const PLAY_THRESHOLD_MS = 30_000;

export function countsAsPlay(record: Pick<PlayRecord, "playedMs" | "completed">): boolean {
  return record.completed || record.playedMs >= PLAY_THRESHOLD_MS;
}

export interface TopTrack {
  track: Track;
  plays: number;
  listenedMs: number;
}

export interface TopArtist {
  key: string;
  id?: string;
  name: string;
  coverUrl?: string;
  plays: number;
  listenedMs: number;
}

export interface StatsSummary {
  totalMs: number;
  playCount: number;
  uniqueTracks: number;
  uniqueArtists: number;
  topTracks: TopTrack[];
  topArtists: TopArtist[];
  bucketMs: number[];
}

function isUsableArtistId(id: string | undefined): id is string {
  return Boolean(id) && id !== "unknown";
}

export function artistKey(artist: PlayRecordArtist): string {
  return isUsableArtistId(artist.id) ? `id:${artist.id}` : `name:${artist.name.trim().toLowerCase()}`;
}

function toTrack(record: PlayRecord): Track {
  const names = record.artists.map((a) => a.name).filter(Boolean);
  const firstId = record.artists.find((a) => isUsableArtistId(a.id))?.id;
  return {
    id: record.trackId,
    title: record.title,
    artists: names.join(", "),
    artistId: firstId,
    artistList: record.artists.map((a) => ({
      id: isUsableArtistId(a.id) ? a.id : undefined,
      name: a.name,
    })),
    coverUrl: record.coverUrl ?? "",
    durationMs: record.durationMs,
    playCount: 0,
    explicit: record.explicit,
    album: record.albumId ? { id: record.albumId, title: record.albumTitle ?? "" } : undefined,
  };
}

function rank<T extends { plays: number; listenedMs: number }>(items: Iterable<T>, limit: number): T[] {
  return Array.from(items)
    .sort((a, b) => b.listenedMs - a.listenedMs || b.plays - a.plays)
    .slice(0, limit);
}

export function summarize(
  records: readonly PlayRecord[],
  buckets: readonly PeriodBucket[] = [],
  limit = 20,
): StatsSummary {
  let totalMs = 0;
  let playCount = 0;
  const tracks = new Map<string, TopTrack>();
  const artists = new Map<string, TopArtist>();
  const bucketMs = new Array<number>(buckets.length).fill(0);

  for (const record of records) {
    const played = Math.max(0, record.playedMs);
    const isPlay = countsAsPlay(record);
    totalMs += played;
    if (isPlay) playCount++;

    const track = tracks.get(record.trackId);
    if (track) {
      track.listenedMs += played;
      if (isPlay) track.plays++;
      // newer listens carry the freshest metadata
      if (record.coverUrl && !track.track.coverUrl) track.track.coverUrl = record.coverUrl;
    } else {
      tracks.set(record.trackId, { track: toTrack(record), plays: isPlay ? 1 : 0, listenedMs: played });
    }

    // time is split between featured artists, plays count for each of them
    const credited = record.artists.length > 0 ? record.artists : [{ name: "" }];
    const share = played / credited.length;
    for (const artist of credited) {
      if (!artist.name.trim()) continue;
      const key = artistKey(artist);
      const entry = artists.get(key);
      if (entry) {
        entry.listenedMs += share;
        if (isPlay) entry.plays++;
        if (!entry.coverUrl && record.coverUrl) entry.coverUrl = record.coverUrl;
      } else {
        artists.set(key, {
          key,
          id: isUsableArtistId(artist.id) ? artist.id : undefined,
          name: artist.name.trim(),
          coverUrl: record.coverUrl,
          plays: isPlay ? 1 : 0,
          listenedMs: share,
        });
      }
    }

    if (buckets.length > 0) {
      const idx = findBucket(buckets, record.ts);
      if (idx >= 0) bucketMs[idx] += played;
    }
  }

  return {
    totalMs,
    playCount,
    uniqueTracks: tracks.size,
    uniqueArtists: artists.size,
    topTracks: rank(tracks.values(), limit),
    topArtists: rank(artists.values(), limit),
    bucketMs,
  };
}

function findBucket(buckets: readonly PeriodBucket[], ts: number): number {
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = buckets[mid];
    if (ts < b.start) hi = mid - 1;
    else if (ts >= b.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export interface TopGenre {
  genre: string;
  listenedMs: number;
  share: number;
}

/** weights each artist's genre by the time spent listening to them; unknown genres are left out */
export function summarizeGenres(
  artists: readonly TopArtist[],
  genreOf: (artist: TopArtist) => string | null | undefined,
  limit = 6,
): TopGenre[] {
  const byGenre = new Map<string, number>();
  let known = 0;
  for (const artist of artists) {
    const genre = genreOf(artist)?.trim();
    if (!genre) continue;
    byGenre.set(genre, (byGenre.get(genre) ?? 0) + artist.listenedMs);
    known += artist.listenedMs;
  }
  if (known <= 0) return [];
  return Array.from(byGenre, ([genre, listenedMs]) => ({ genre, listenedMs, share: listenedMs / known }))
    .sort((a, b) => b.listenedMs - a.listenedMs)
    .slice(0, limit);
}
