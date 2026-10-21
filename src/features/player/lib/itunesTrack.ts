// genre, album and release details of a song from the public itunes search, the catalog
// itself doesn't carry them; looked up once per song and session

export interface ItunesTrackInfo {
  genre?: string;
  album?: string;
  releaseDate?: string;
  trackNumber?: number;
  trackCount?: number;
  discNumber?: number;
  discCount?: number;
  country?: string;
}

interface ItunesSongResult {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  trackNumber?: number;
  trackCount?: number;
  discNumber?: number;
  discCount?: number;
  country?: string;
}

const LOOKUP_TIMEOUT_MS = 8_000;
const cache = new Map<string, Promise<ItunesTrackInfo | null>>();

/** lower case, without "(feat. …)", "- 2011 remaster" and punctuation, for loose matching */
export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function firstArtist(artists: string): string {
  return normalizeTitle(artists.split(/,|&| feat\.? | x /i)[0] ?? "");
}

/** the result whose title and main artist match, or null when none does */
export function pickItunesSong(
  results: readonly ItunesSongResult[],
  title: string,
  artists: string,
): ItunesSongResult | null {
  const wantTitle = normalizeTitle(title);
  const wantArtist = firstArtist(artists);
  const titleMatches = results.filter((r) => r.trackName && normalizeTitle(r.trackName) === wantTitle);
  return (
    titleMatches.find((r) => r.artistName && normalizeTitle(r.artistName).includes(wantArtist)) ??
    (wantArtist ? null : titleMatches[0] ?? null)
  );
}

function toInfo(result: ItunesSongResult): ItunesTrackInfo {
  return {
    genre: result.primaryGenreName || undefined,
    album: result.collectionName || undefined,
    releaseDate: result.releaseDate || undefined,
    trackNumber: result.trackNumber || undefined,
    trackCount: result.trackCount || undefined,
    discNumber: result.discNumber || undefined,
    discCount: result.discCount || undefined,
    country: result.country || undefined,
  };
}

async function fetchInfo(title: string, artists: string): Promise<ItunesTrackInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const term = `${artists.split(",")[0] ?? ""} ${title}`.trim();
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10`;
    const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: ItunesSongResult[] };
    const match = pickItunesSong(body.results ?? [], title, artists);
    return match ? toInfo(match) : null;
  } finally {
    clearTimeout(timer);
  }
}

export function lookupItunesTrack(title: string, artists: string): Promise<ItunesTrackInfo | null> {
  const key = `${normalizeTitle(artists)}|${normalizeTitle(title)}`;
  let pending = cache.get(key);
  if (!pending) {
    // a failed lookup is not cached, so it is tried again next time
    pending = fetchInfo(title, artists).catch(() => {
      cache.delete(key);
      return null;
    });
    cache.set(key, pending);
  }
  return pending;
}
