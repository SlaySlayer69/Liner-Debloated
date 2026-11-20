// read-only spotify web api calls for the library sync; the access token comes from the
// main process, which keeps the refresh token encrypted and refreshes it when needed

const API = "https://api.spotify.com/v1";
const MAX_RETRIES = 3;

export interface SpotifyImage {
  url: string;
  width?: number | null;
}

export interface SpotifyArtistRef {
  id: string | null;
  name: string;
}

export interface SpotifyTrack {
  id: string | null;
  name: string;
  artists: SpotifyArtistRef[];
  album?: { id: string | null; name: string; images?: SpotifyImage[] };
  duration_ms: number;
  is_local?: boolean;
  type?: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string | null;
  snapshot_id: string;
  owner?: { id: string; display_name?: string | null };
  collaborative?: boolean;
  images?: SpotifyImage[] | null;
  /** since february 2026 the song count lives under `items` */
  items?: { total: number } | null;
  tracks?: { total: number } | null;
}

export type LibrarySection = "liked" | "albums" | "artists";

export interface SpotifyAlbum {
  id: string;
  name: string;
  artists: SpotifyArtistRef[];
  images?: SpotifyImage[];
  total_tracks?: number;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  images?: SpotifyImage[];
}

export interface SpotifyProfile {
  id: string;
  display_name?: string | null;
  images?: SpotifyImage[];
}

export class SpotifyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** the message spotify sent along, e.g. why a request was forbidden */
    readonly detail?: string,
  ) {
    super(message);
  }
}

export interface SpotifyClient {
  me(): Promise<SpotifyProfile>;
  playlists(): Promise<SpotifyPlaylist[]>;
  playlistTracks(playlistId: string): Promise<SpotifyTrack[]>;
  savedTracks(): Promise<SpotifyTrack[]>;
  savedAlbums(): Promise<SpotifyAlbum[]>;
  followedArtists(): Promise<SpotifyArtist[]>;
  /** cheap change marker: total count plus the newest entry */
  libraryFingerprint(section: LibrarySection): Promise<string>;
}

type TokenSource = () => Promise<string | null>;

const defaultToken: TokenSource = async () =>
  (await window.linerElectron?.spotifyAccessToken?.()) ?? null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createSpotifyClient(
  getToken: TokenSource = defaultToken,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): SpotifyClient {
  async function get<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API}${pathOrUrl}`;
    for (let attempt = 0; ; attempt++) {
      const token = await getToken();
      if (!token) throw new SpotifyApiError(401, "not_connected");
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const wait =
          Number(response.headers.get("Retry-After")) || 2 ** attempt;
        await sleep(Math.min(wait, 30) * 1000);
        continue;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string } | string;
          error_description?: string;
        } | null;
        const detail =
          typeof body?.error === "object"
            ? body.error.message
            : (body?.error_description ?? body?.error);
        throw new SpotifyApiError(
          response.status,
          `spotify_${response.status}`,
          detail || undefined,
        );
      }
      return (await response.json()) as T;
    }
  }

  /** follows `next` links until the list ends */
  async function allPages<T>(first: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | null = first;
    while (next) {
      const page: { items: T[]; next: string | null } = await get(next);
      items.push(...page.items);
      next = page.next;
    }
    return items;
  }

  const trackOf = (item: { track?: SpotifyTrack | null }) => item.track ?? null;
  const onlyTracks = (tracks: (SpotifyTrack | null)[]) =>
    tracks.filter((t): t is SpotifyTrack =>
      Boolean(t && t.id && !t.is_local && t.type !== "episode"),
    );

  return {
    me: () => get<SpotifyProfile>("/me"),
    playlists: () => allPages<SpotifyPlaylist>("/me/playlists?limit=50"),
    async playlistTracks(playlistId) {
      const id = encodeURIComponent(playlistId);
      let items: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[];
      try {
        items = await allPages(`/playlists/${id}/items?limit=100`);
      } catch (error) {
        // apps with extended quota may still only know the old /tracks path
        if (
          !(error instanceof SpotifyApiError) ||
          (error.status !== 404 && error.status !== 410)
        )
          throw error;
        items = await allPages(`/playlists/${id}/tracks?limit=100`);
      }
      return onlyTracks(
        items.map((entry) => entry.track ?? entry.item ?? null),
      );
    },
    async savedTracks() {
      return onlyTracks(
        (await allPages<{ track: SpotifyTrack }>("/me/tracks?limit=50")).map(
          trackOf,
        ),
      );
    },
    async savedAlbums() {
      return (
        await allPages<{ album: SpotifyAlbum }>("/me/albums?limit=50")
      ).map((item) => item.album);
    },
    async followedArtists() {
      const artists: SpotifyArtist[] = [];
      let next: string | null = "/me/following?type=artist&limit=50";
      while (next) {
        const page: {
          artists: { items: SpotifyArtist[]; next: string | null };
        } = await get(next);
        artists.push(...page.artists.items);
        next = page.artists.next;
      }
      return artists;
    },
    async libraryFingerprint(section) {
      if (section === "artists") {
        const page = await get<{
          artists: { total: number; items: { id: string }[] };
        }>("/me/following?type=artist&limit=1");
        return `${page.artists.total}:${page.artists.items[0]?.id ?? ""}`;
      }
      const page = await get<{
        total: number;
        items: {
          added_at: string;
          track?: { id: string | null };
          album?: { id: string };
        }[];
      }>(section === "liked" ? "/me/tracks?limit=1" : "/me/albums?limit=1");
      const first = page.items[0];
      return `${page.total}:${first?.track?.id ?? first?.album?.id ?? ""}:${first?.added_at ?? ""}`;
    },
  };
}
