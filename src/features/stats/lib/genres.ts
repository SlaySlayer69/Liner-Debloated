// the catalog has no genres, so an artist's primary genre is looked up once in the public
// itunes search and remembered on this device
const STORAGE_KEY = "liner_artist_genres_v1";
const MISS_RETRY_MS = 7 * 86_400_000;
const LOOKUP_TIMEOUT_MS = 8_000;

interface CachedGenre {
  // empty when the lookup found nothing
  g: string;
  t: number;
}

let cache: Record<string, CachedGenre> | null = null;
const inFlight = new Map<string, Promise<string | null>>();

function load(): Record<string, CachedGenre> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, CachedGenre>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache ?? {}));
  } catch {}
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/** cached genre, "" when known to be unknown, undefined when never looked up (or due for a retry) */
export function getCachedGenre(artistName: string, now = Date.now()): string | undefined {
  const hit = load()[normalize(artistName)];
  if (!hit) return undefined;
  if (!hit.g && now - hit.t > MISS_RETRY_MS) return undefined;
  return hit.g;
}

interface ItunesArtistResult {
  artistName?: string;
  primaryGenreName?: string;
}

export function pickGenre(artistName: string, results: readonly ItunesArtistResult[]): string {
  const wanted = normalize(artistName);
  const exact = results.find((r) => r.artistName && normalize(r.artistName) === wanted);
  return (exact ?? results[0])?.primaryGenreName?.trim() ?? "";
}

async function fetchGenre(artistName: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=musicArtist&limit=3`;
    const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: ItunesArtistResult[] };
    return pickGenre(artistName, body.results ?? []);
  } catch {
    // offline or rate limited: try again next time
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function lookupGenre(artistName: string): Promise<string | null> {
  const key = normalize(artistName);
  if (!key) return Promise.resolve(null);
  const cached = getCachedGenre(artistName);
  if (cached !== undefined) return Promise.resolve(cached);
  const running = inFlight.get(key);
  if (running) return running;

  const task = fetchGenre(artistName)
    .then((genre) => {
      if (genre !== null) {
        load()[key] = { g: genre, t: Date.now() };
        save();
      }
      return genre;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, task);
  return task;
}

/** looks up a few artists at a time so the itunes rate limit is never hit in a burst */
export async function lookupGenres(artistNames: readonly string[], concurrency = 3): Promise<void> {
  const queue = artistNames.filter((name) => getCachedGenre(name) === undefined);
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next) await lookupGenre(next);
    }
  });
  await Promise.all(workers);
}
