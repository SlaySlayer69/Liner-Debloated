import { describe, expect, it } from "vitest";
import { normalizeTitle, pickItunesSong } from "./itunesTrack";

describe("normalizeTitle", () => {
  it("drops features, remaster suffixes and punctuation", () => {
    expect(normalizeTitle("Kids with Guns (feat. Neneh Cherry)")).toBe("kids with guns");
    expect(normalizeTitle("No Surprises - 2017 Remaster")).toBe("no surprises");
    expect(normalizeTitle("Jigsaw Falling Into Place!")).toBe("jigsaw falling into place");
    expect(normalizeTitle("Дни и ночи")).toBe("дни и ночи");
  });
});

describe("pickItunesSong", () => {
  const results = [
    { trackName: "No Surprises", artistName: "Some Cover Band", primaryGenreName: "Pop" },
    { trackName: "No Surprises (Remastered)", artistName: "Radiohead", primaryGenreName: "Alternative" },
    { trackName: "Karma Police", artistName: "Radiohead", primaryGenreName: "Alternative" },
  ];

  it("needs both the title and the main artist to match", () => {
    expect(pickItunesSong(results, "No Surprises", "Radiohead")?.primaryGenreName).toBe("Alternative");
    expect(pickItunesSong(results, "Kids with Guns", "Gorillaz, Neneh Cherry")).toBeNull();
  });

  it("matches the first of several credited artists", () => {
    const hits = [{ trackName: "Kids With Guns", artistName: "Gorillaz", primaryGenreName: "Alternative" }];
    expect(pickItunesSong(hits, "Kids with Guns", "Gorillaz, Neneh Cherry")?.primaryGenreName).toBe("Alternative");
  });
});
