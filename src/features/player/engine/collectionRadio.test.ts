import { describe, expect, it } from "vitest";
import type { Track } from "@/shared/types";
import { isRadioContext } from "./radioMode";
import { CollectionDeck, collectionRadioContext, interleave, mixRadioBatch, pickSeeds } from "./collectionRadio";

const t = (id: string): Track => ({ id, title: id, artists: "A", coverUrl: "", durationMs: 1000, playCount: 0 });
const ids = (tracks: Track[]) => tracks.map((x) => x.id);

// deterministic "random" so shuffles are reproducible
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("collectionRadioContext", () => {
  it("is a radio context, so the queue refills and never loops", () => {
    const context = collectionRadioContext({ kind: "playlist", id: "p1" });
    expect(context).toBe("radio:collection:playlist:p1");
    expect(isRadioContext(context)).toBe(true);
  });
});

describe("mixRadioBatch", () => {
  it("alternates own and similar songs and appends what is left", () => {
    expect(ids(mixRadioBatch([t("o1"), t("o2"), t("o3")], [t("s1"), t("s2")]))).toEqual(["o1", "s1", "o2", "s2", "o3"]);
    expect(ids(mixRadioBatch([t("o1")], [t("s1"), t("s2"), t("s3")]))).toEqual(["o1", "s1", "s2", "s3"]);
  });

  it("can start with a similar song", () => {
    expect(ids(mixRadioBatch([t("o1"), t("o2")], [t("s1"), t("s2")], new Set(), true))).toEqual(["s1", "o1", "s2", "o2"]);
  });

  it("drops duplicates and excluded ids", () => {
    const mixed = mixRadioBatch([t("o1"), t("o2")], [t("o1"), t("s1"), t("s1"), t("q")], new Set(["q", "o2"]));
    expect(ids(mixed)).toEqual(["o1", "s1"]);
    // repeated similar songs don't eat the turn of the next one
    expect(ids(mixRadioBatch([t("o1"), t("o2")], [t("s1"), t("s1"), t("s2")]))).toEqual(["o1", "s1", "o2", "s2"]);
  });
});

describe("interleave", () => {
  it("takes one from each list in turn", () => {
    expect(interleave([[1, 2, 3], [10], [20, 21]])).toEqual([1, 10, 20, 2, 21, 3]);
    expect(interleave([])).toEqual([]);
  });
});

describe("pickSeeds", () => {
  it("picks distinct tracks, never more than the pool has", () => {
    const pool = [t("a"), t("b"), t("c")];
    const seeds = pickSeeds(pool, 2, seeded(3));
    expect(seeds).toHaveLength(2);
    expect(new Set(ids(seeds)).size).toBe(2);
    expect(pickSeeds(pool, 10)).toHaveLength(3);
  });
});

describe("CollectionDeck", () => {
  it("deals every song once before reshuffling", () => {
    const pool = [t("a"), t("b"), t("c"), t("d"), t("e")];
    const deck = new CollectionDeck(pool, seeded(7));
    const first = ids(deck.draw(3));
    const second = ids(deck.draw(2));
    expect(new Set([...first, ...second])).toEqual(new Set(["a", "b", "c", "d", "e"]));
    // deck exhausted: keeps dealing from a fresh shuffle
    expect(deck.draw(4)).toHaveLength(4);
  });

  it("skips songs to avoid, e.g. the ones just queued", () => {
    const deck = new CollectionDeck([t("a"), t("b"), t("c")], seeded(2));
    const drawn = ids(deck.draw(3, new Set(["b"])));
    expect(drawn).not.toContain("b");
    expect(drawn.sort()).toEqual(["a", "c"]);
  });

  it("works for a single-song collection", () => {
    const deck = new CollectionDeck([t("only")]);
    expect(ids(deck.draw(5))).toEqual(["only"]);
  });
});
