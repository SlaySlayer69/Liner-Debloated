import { describe, it, expect, beforeEach } from "vitest";
import { sidebarPinHref, useSidebarPinsStore, type SidebarPin } from "./sidebarPinsStore";

const album: SidebarPin = { kind: "album", id: "al1", title: "Album", href: "/collection?type=album&id=al1" };
const artist: SidebarPin = { kind: "artist", id: "ar1", title: "Artist", href: "/artist?id=ar1" };
const playlist: SidebarPin = { kind: "playlist", id: "pl1", title: "Mine", href: "/library/playlist?id=pl1" };

describe("sidebarPinsStore", () => {
  beforeEach(() => {
    useSidebarPinsStore.setState({ pins: [] });
  });

  it("pins in order and toggles off again", () => {
    const store = useSidebarPinsStore.getState();
    expect(store.toggle(album)).toBe(true);
    expect(store.toggle(artist)).toBe(true);
    expect(useSidebarPinsStore.getState().pins.map((p) => p.id)).toEqual(["al1", "ar1"]);

    expect(useSidebarPinsStore.getState().toggle(album)).toBe(false);
    expect(useSidebarPinsStore.getState().pins.map((p) => p.id)).toEqual(["ar1"]);
  });

  it("refreshes an existing pin in place instead of duplicating it", () => {
    const store = useSidebarPinsStore.getState();
    store.pin(album);
    store.pin(artist);
    useSidebarPinsStore.getState().pin({ ...album, title: "Renamed", imageUrl: "cover" });
    expect(useSidebarPinsStore.getState().pins).toEqual([
      { ...album, title: "Renamed", imageUrl: "cover" },
      artist,
    ]);
  });

  it("keeps the same id apart across kinds and moves pins", () => {
    const store = useSidebarPinsStore.getState();
    store.pin(album);
    store.pin({ ...artist, id: "al1" });
    store.pin(playlist);
    expect(useSidebarPinsStore.getState().pins).toHaveLength(3);

    useSidebarPinsStore.getState().move(2, 0);
    expect(useSidebarPinsStore.getState().pins.map((p) => p.kind)).toEqual(["playlist", "album", "artist"]);
    useSidebarPinsStore.getState().move(0, 5);
    expect(useSidebarPinsStore.getState().pins.map((p) => p.kind)).toEqual(["playlist", "album", "artist"]);
  });

  it("builds the route for each kind", () => {
    expect(sidebarPinHref("artist", "a b")).toBe("/artist?id=a%20b");
    expect(sidebarPinHref("album", "x")).toBe("/collection?type=album&id=x");
    expect(sidebarPinHref("playlist", "x")).toBe("/collection?type=playlist&id=x");
    expect(sidebarPinHref("playlist", "x", true)).toBe("/library/playlist?id=x");
  });
});
