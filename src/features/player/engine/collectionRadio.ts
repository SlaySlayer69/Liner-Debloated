import type { Track } from "@/shared/types";
import { RADIO_CONTEXT_PREFIX } from "./radioMode";

// Radio on a playlist, album or artist ("smart shuffle"): an endless queue of the
// collection's own songs, shuffled, with similar songs from the radio engine mixed in.
// It is a radio context, so it never loops and refills like the track radio does.

export type CollectionRadioKind = "playlist" | "album" | "artist";

export interface CollectionRadioSource {
  kind: CollectionRadioKind;
  id: string;
  title: string;
  coverUrl?: string;
}

export function collectionRadioContext(source: Pick<CollectionRadioSource, "kind" | "id">): string {
  return `${RADIO_CONTEXT_PREFIX}collection:${source.kind}:${source.id}`;
}

/** own songs per batch, and how many similar songs follow each own song */
export const COLLECTION_BATCH_OWN = 8;
export const SIMILAR_PER_OWN = 1;
/** songs of the collection that seed the similar-song lookups of one batch */
export const SEEDS_PER_BATCH = 3;

export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** up to `count` distinct tracks of the pool, chosen at random */
export function pickSeeds(pool: readonly Track[], count: number, random: () => number = Math.random): Track[] {
  return shuffled(pool, random).slice(0, Math.max(0, count));
}

/** round-robin over several result lists, so no single seed dominates the similar songs */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i]);
  }
  return out;
}

/**
 * own, similar, own, similar, ... (SIMILAR_PER_OWN similar songs after each own one), or
 * similar first when the queue already ends on an own song; whatever is left of either list
 * goes at the end, duplicates and `exclude` ids are dropped
 */
export function mixRadioBatch(
  own: readonly Track[],
  similar: readonly Track[],
  exclude: ReadonlySet<string> = new Set(),
  similarFirst = false,
): Track[] {
  const seen = new Set(exclude);
  const out: Track[] = [];
  const push = (track: Track | undefined) => {
    if (!track || !track.id || seen.has(track.id)) return;
    seen.add(track.id);
    out.push(track);
  };
  // drop unusable similar songs up front, so a duplicate never takes a similar song's turn
  const ownIds = new Set(own.map((track) => track.id));
  const usable = new Set<string>();
  const extra = similar.filter((track) => {
    if (!track?.id || exclude.has(track.id) || ownIds.has(track.id) || usable.has(track.id)) return false;
    usable.add(track.id);
    return true;
  });

  let s = 0;
  const pushSimilar = () => {
    for (let n = 0; n < SIMILAR_PER_OWN && s < extra.length; n++) push(extra[s++]);
  };
  if (similarFirst) pushSimilar();
  for (const track of own) {
    push(track);
    pushSimilar();
  }
  while (s < extra.length) push(extra[s++]);
  return out;
}

/**
 * the collection's songs in a shuffled order that is consumed batch by batch; once every
 * song has had its turn the deck is reshuffled, so the radio never runs out
 */
export class CollectionDeck {
  private deck: Track[] = [];

  constructor(
    readonly pool: readonly Track[],
    private readonly random: () => number = Math.random,
  ) {}

  draw(count: number, avoid: ReadonlySet<string> = new Set()): Track[] {
    const out: Track[] = [];
    // two passes at most: the rest of this deck, then one fresh shuffle
    for (let pass = 0; pass < 2 && out.length < count; pass++) {
      if (this.deck.length === 0) this.deck = shuffled(this.pool, this.random);
      while (this.deck.length > 0 && out.length < count) {
        const next = this.deck.shift()!;
        if (!avoid.has(next.id) && !out.some((t) => t.id === next.id)) out.push(next);
      }
    }
    return out;
  }
}
