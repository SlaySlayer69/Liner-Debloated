import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/shared/contracts";
import {
  SpotifyApiError,
  type SpotifyAlbum,
  type SpotifyClient,
  type SpotifyPlaylist,
  type SpotifyTrack,
} from "../api/spotifyClient";
import {
  LinerPlaylistMissingError,
  runSpotifySync,
  type LinerTarget,
} from "./syncEngine";
import {
  emptyLedger,
  type SpotifySyncSettings,
  type SyncLedger,
} from "./types";
import type { PublicSpotifySource } from "../links/publicSource";

const settings = (
  over: Partial<SpotifySyncSettings> = {},
): SpotifySyncSettings => ({
  clientId: "x",
  autoSync: true,
  liked: true,
  albums: false,
  artists: false,
  playlistsMode: "none",
  selectedPlaylists: [],
  intervalMinutes: 5,
  linkedSources: [],
  ...over,
});

const sTrack = (id: string): SpotifyTrack => ({
  id,
  name: `song ${id}`,
  artists: [{ id: "a", name: "artist" }],
  duration_ms: 1000,
});

const lTrack = (id: string): Track => ({
  id: `yt-${id}`,
  title: `song ${id}`,
  artists: [{ id: "a", name: "artist" }],
  durationMs: 1000,
});

function fakeSpotify(state: {
  liked?: SpotifyTrack[];
  albums?: SpotifyAlbum[];
  playlists?: SpotifyPlaylist[];
  playlistTracks?: Record<string, SpotifyTrack[]>;
}): SpotifyClient {
  return {
    me: async () => ({ id: "me" }),
    playlists: async () => state.playlists ?? [],
    playlistTracks: async (id) => state.playlistTracks?.[id] ?? [],
    savedTracks: async () => state.liked ?? [],
    savedAlbums: async () => state.albums ?? [],
    followedArtists: async () => [],
    libraryFingerprint: async (section) =>
      section === "liked"
        ? (state.liked ?? []).map((t) => t.id).join(",")
        : section === "albums"
          ? (state.albums ?? []).map((a) => a.id).join(",")
          : "",
  };
}

function fakeLiner(initialLikes: string[] = []) {
  const likes = new Set(initialLikes);
  const albums = new Set<string>();
  const playlists = new Map<string, Map<string, string>>();
  let nextItem = 0;
  let nextPlaylist = 0;
  const target: LinerTarget = {
    matchTrack: vi.fn(async (track: SpotifyTrack) =>
      track.id?.startsWith("x") ? null : lTrack(track.id!),
    ),
    matchAlbum: async (album) => ({ id: `al-${album.id}`, snapshot: {} }),
    matchArtist: async () => null,
    likedTrackIds: async () => new Set(likes),
    setLiked: vi.fn(async (id: string, liked: boolean) => {
      if (liked) likes.add(id);
      else likes.delete(id);
    }),
    savedCollectionIds: async () => new Set(albums),
    saveCollection: async (_type, item) => {
      albums.add(item.id);
    },
    removeCollection: async (_type, id) => {
      albums.delete(id);
    },
    createPlaylist: vi.fn(async (title: string) => {
      const id = `pl-${title}-${nextPlaylist++}`;
      playlists.set(id, new Map());
      return id;
    }),
    hasPlaylist: async (id) => playlists.has(id),
    addPlaylistTracks: async (playlistId, tracks) => {
      const items = playlists.get(playlistId);
      if (!items) throw new LinerPlaylistMissingError();
      const added: Record<string, string> = {};
      for (const track of tracks) {
        const itemId = `item-${nextItem++}`;
        items.set(track.id, itemId);
        added[track.id] = itemId;
      }
      return added;
    },
    removePlaylistItem: async (playlistId, itemId) => {
      const items = playlists.get(playlistId);
      if (!items) throw new LinerPlaylistMissingError();
      for (const [trackId, id] of items)
        if (id === itemId) items.delete(trackId);
    },
  };
  return { target, likes, albums, playlists };
}

describe("runSpotifySync", () => {
  it("likes new songs and only unlikes the ones it liked itself", async () => {
    const liner = fakeLiner(["yt-2"]);
    const spotify = { liked: [sTrack("1"), sTrack("2"), sTrack("x3")] };
    const first = await runSpotifySync(
      fakeSpotify(spotify),
      liner.target,
      settings(),
      emptyLedger(),
    );
    expect([...liner.likes].sort()).toEqual(["yt-1", "yt-2"]);
    expect(first.result).toMatchObject({
      added: 1,
      unmatched: 1,
      skipped: false,
    });

    // both songs leave spotify: the one the user had liked before stays
    spotify.liked = [];
    const second = await runSpotifySync(
      fakeSpotify(spotify),
      liner.target,
      settings(),
      first.ledger,
    );
    expect([...liner.likes]).toEqual(["yt-2"]);
    expect(second.result.removed).toBe(1);
  });

  it("skips unchanged sections and reuses cached matches", async () => {
    const liner = fakeLiner();
    const spotify = fakeSpotify({ liked: [sTrack("1")] });
    const first = await runSpotifySync(
      spotify,
      liner.target,
      settings(),
      emptyLedger(),
    );
    const second = await runSpotifySync(
      spotify,
      liner.target,
      settings(),
      first.ledger,
    );
    expect(second.result.skipped).toBe(true);
    await runSpotifySync(spotify, liner.target, settings(), first.ledger, {
      force: true,
    });
    expect(liner.target.matchTrack).toHaveBeenCalledTimes(1);
  });

  it("mirrors saved albums", async () => {
    const liner = fakeLiner();
    const state = {
      albums: [{ id: "A", name: "album", artists: [] }] as SpotifyAlbum[],
    };
    const cfg = settings({ liked: false, albums: true });
    const first = await runSpotifySync(
      fakeSpotify(state),
      liner.target,
      cfg,
      emptyLedger(),
    );
    expect([...liner.albums]).toEqual(["al-A"]);
    state.albums = [];
    await runSpotifySync(fakeSpotify(state), liner.target, cfg, first.ledger);
    expect(liner.albums.size).toBe(0);
  });

  it("copies only the selected playlists and follows their changes", async () => {
    const liner = fakeLiner();
    const state = {
      playlists: [
        { id: "p1", name: "Mix", snapshot_id: "s1", owner: { id: "me" } },
        { id: "p2", name: "Other", snapshot_id: "s1", owner: { id: "me" } },
      ] as SpotifyPlaylist[],
      playlistTracks: { p1: [sTrack("1"), sTrack("2"), sTrack("1")] } as Record<
        string,
        SpotifyTrack[]
      >,
    };
    const cfg = settings({
      liked: false,
      playlistsMode: "selected",
      selectedPlaylists: ["p1"],
    });
    const first = await runSpotifySync(
      fakeSpotify(state),
      liner.target,
      cfg,
      emptyLedger(),
    );
    expect(liner.target.createPlaylist).toHaveBeenCalledTimes(1);
    const linerId = first.ledger.playlists.p1.linerId;
    expect([...liner.playlists.get(linerId)!.keys()]).toEqual(["yt-1", "yt-2"]);

    state.playlists[0].snapshot_id = "s2";
    state.playlistTracks.p1 = [sTrack("2"), sTrack("3")];
    const second = await runSpotifySync(
      fakeSpotify(state),
      liner.target,
      cfg,
      first.ledger,
    );
    expect([...liner.playlists.get(linerId)!.keys()]).toEqual(["yt-2", "yt-3"]);
    expect(second.result).toMatchObject({ added: 1, removed: 1, playlists: 1 });

    // deleted in liner: a new copy is made on the next change
    liner.playlists.delete(linerId);
    state.playlists[0].snapshot_id = "s3";
    const third = await runSpotifySync(
      fakeSpotify(state),
      liner.target,
      cfg,
      second.ledger,
    );
    expect(third.ledger.playlists.p1.linerId).not.toBe(linerId);
    expect(liner.playlists.get(third.ledger.playlists.p1.linerId)!.size).toBe(
      2,
    );
  });

  it("skips playlists spotify does not share the songs of", async () => {
    const liner = fakeLiner();
    const state = {
      playlists: [
        { id: "mine", name: "Mine", snapshot_id: "s", owner: { id: "me" } },
        {
          id: "shared",
          name: "Team",
          snapshot_id: "s",
          owner: { id: "x" },
          collaborative: true,
        },
        {
          id: "followed",
          name: "Top 50",
          snapshot_id: "s",
          owner: { id: "spotify" },
        },
      ] as SpotifyPlaylist[],
      playlistTracks: { mine: [sTrack("1")], shared: [sTrack("2")] } as Record<
        string,
        SpotifyTrack[]
      >,
    };
    const cfg = settings({ liked: false, playlistsMode: "all" });
    const { ledger, result } = await runSpotifySync(
      fakeSpotify(state),
      liner.target,
      cfg,
      emptyLedger(),
    );
    expect(Object.keys(ledger.playlists).sort()).toEqual(["mine", "shared"]);
    expect(result).toMatchObject({ playlists: 2, skippedPlaylists: 1 });
    expect(result.error).toBeUndefined();
  });

  it("keeps syncing the other parts when one is forbidden", async () => {
    const liner = fakeLiner();
    const spotify = fakeSpotify({
      albums: [{ id: "A", name: "album", artists: [] }] as SpotifyAlbum[],
    });
    spotify.libraryFingerprint = async (section) => {
      if (section === "liked")
        throw new SpotifyApiError(
          403,
          "spotify_403",
          "user may not be registered",
        );
      return "fp";
    };
    const cfg = settings({ albums: true });
    const { result } = await runSpotifySync(
      spotify,
      liner.target,
      cfg,
      emptyLedger(),
    );
    expect([...liner.albums]).toEqual(["al-A"]);
    expect(result).toMatchObject({
      error: "spotify_403",
      errorDetail: "user may not be registered",
      skipped: false,
    });
  });

  describe("public links without a spotify sign-in", () => {
    const imported = (id: string) => ({
      sourceId: id,
      title: `song ${id}`,
      artists: ["artist"],
      durationMs: 1000,
    });

    function fakePublic(state: {
      playlist: { ids: string[]; complete: boolean };
    }): PublicSpotifySource {
      return {
        read: async (kind, id) => ({
          kind,
          id,
          title: kind === "album" ? "Album" : "Public mix",
          tracks:
            kind === "album"
              ? [imported("a1")]
              : state.playlist.ids.map(imported),
          complete: kind === "album" || state.playlist.complete,
        }),
      };
    }

    const notSignedIn: SpotifyClient = {
      ...fakeSpotify({}),
      libraryFingerprint: async () => {
        throw new SpotifyApiError(401, "not_connected");
      },
    };

    it("mirrors a linked playlist and only removes after a complete read", async () => {
      const liner = fakeLiner();
      const state = { playlist: { ids: ["1", "2"], complete: true } };
      const cfg = settings({
        linkedSources: [
          {
            kind: "playlist",
            id: "PL",
            url: "https://open.spotify.com/playlist/PL",
            title: "Public mix",
          },
        ],
      });
      const run = (ledger: SyncLedger, force = false) =>
        runSpotifySync(notSignedIn, liner.target, cfg, ledger, {
          account: false,
          publicSource: fakePublic(state),
          force,
        });

      const first = await run(emptyLedger());
      expect(first.result.error).toBeUndefined();
      const linerId = first.ledger.playlists["link:PL"].linerId;
      expect([...liner.playlists.get(linerId)!.keys()]).toEqual([
        "yt-1",
        "yt-2",
      ]);

      // unchanged list: nothing to do
      expect((await run(first.ledger)).result.skipped).toBe(true);

      // a partial read adds but never removes
      state.playlist = { ids: ["3"], complete: false };
      const partial = await run(first.ledger);
      expect([...liner.playlists.get(linerId)!.keys()]).toEqual([
        "yt-1",
        "yt-2",
        "yt-3",
      ]);

      state.playlist = { ids: ["3"], complete: true };
      await run(partial.ledger);
      expect([...liner.playlists.get(linerId)!.keys()]).toEqual(["yt-3"]);
    });

    it("saves a linked album and removes it again with the link", async () => {
      const liner = fakeLiner();
      const link = {
        kind: "album" as const,
        id: "AL",
        url: "u",
        title: "Album",
      };
      const options = {
        account: false,
        publicSource: fakePublic({ playlist: { ids: [], complete: true } }),
      };
      const first = await runSpotifySync(
        notSignedIn,
        liner.target,
        settings({ linkedSources: [link] }),
        emptyLedger(),
        options,
      );
      expect([...liner.albums]).toEqual(["al-AL"]);
      await runSpotifySync(
        notSignedIn,
        liner.target,
        settings(),
        first.ledger,
        options,
      );
      expect(liner.albums.size).toBe(0);
    });
  });
});
