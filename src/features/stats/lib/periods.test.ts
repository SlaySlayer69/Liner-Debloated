import { describe, expect, it } from "vitest";
import { getPeriodBuckets, getPeriodRange, hasOlderPeriod } from "./periods";

// wednesday, 2026-10-21 15:30 local time
const NOW = new Date(2026, 9, 21, 15, 30).getTime();
const at = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).getTime();

describe("getPeriodRange", () => {
  it("covers today and earlier days", () => {
    expect(getPeriodRange("day", 0, NOW)).toEqual({ start: at(2026, 9, 21), end: at(2026, 9, 22) });
    expect(getPeriodRange("day", 1, NOW)).toEqual({ start: at(2026, 9, 20), end: at(2026, 9, 21) });
    // across a month boundary
    expect(getPeriodRange("day", 21, NOW)).toEqual({ start: at(2026, 8, 30), end: at(2026, 9, 1) });
  });

  it("starts weeks on monday", () => {
    expect(getPeriodRange("week", 0, NOW)).toEqual({ start: at(2026, 9, 19), end: at(2026, 9, 26) });
    expect(getPeriodRange("week", 1, NOW)).toEqual({ start: at(2026, 9, 12), end: at(2026, 9, 19) });
    // a sunday still belongs to the week that began the monday before
    const sunday = new Date(2026, 9, 25, 23).getTime();
    expect(getPeriodRange("week", 0, sunday).start).toBe(at(2026, 9, 19));
  });

  it("walks back months and years across the new year", () => {
    expect(getPeriodRange("month", 0, NOW)).toEqual({ start: at(2026, 9, 1), end: at(2026, 10, 1) });
    expect(getPeriodRange("month", 10, NOW)).toEqual({ start: at(2025, 11, 1), end: at(2026, 0, 1) });
    expect(getPeriodRange("year", 1, NOW)).toEqual({ start: at(2025, 0, 1), end: at(2026, 0, 1) });
  });

  it("spans all time from the month of the first listen to the end of today", () => {
    const first = new Date(2025, 2, 14, 9).getTime();
    expect(getPeriodRange("all", 3, NOW, first)).toEqual({ start: at(2025, 2, 1), end: at(2026, 9, 22) });
  });
});

describe("hasOlderPeriod", () => {
  it("allows going back only while older data can exist", () => {
    const first = new Date(2026, 9, 20, 12).getTime();
    expect(hasOlderPeriod("day", 0, first, NOW)).toBe(true);
    expect(hasOlderPeriod("day", 1, first, NOW)).toBe(false);
    // the first listen falls into this week already
    expect(hasOlderPeriod("week", 0, first, NOW)).toBe(false);
    expect(hasOlderPeriod("week", 0, at(2026, 9, 18, 12), NOW)).toBe(true);
    expect(hasOlderPeriod("all", 0, first, NOW)).toBe(false);
    expect(hasOlderPeriod("day", 0, null, NOW)).toBe(false);
  });
});

describe("getPeriodBuckets", () => {
  it("uses hours for a day, days for weeks and months, months for a year", () => {
    const day = getPeriodBuckets("day", getPeriodRange("day", 0, NOW));
    expect(day.unit).toBe("hour");
    expect(day.buckets).toHaveLength(24);
    expect(day.buckets[15].start).toBe(at(2026, 9, 21, 15));

    expect(getPeriodBuckets("week", getPeriodRange("week", 0, NOW)).buckets).toHaveLength(7);
    const month = getPeriodBuckets("month", getPeriodRange("month", 0, NOW));
    expect(month.unit).toBe("day");
    expect(month.buckets).toHaveLength(31);
    expect(getPeriodBuckets("month", getPeriodRange("month", 8, NOW)).buckets).toHaveLength(28);

    const year = getPeriodBuckets("year", getPeriodRange("year", 0, NOW));
    expect(year.unit).toBe("month");
    expect(year.buckets).toHaveLength(12);
  });

  it("switches all time to years once there is more than two years of history", () => {
    const short = getPeriodBuckets("all", getPeriodRange("all", 0, NOW, at(2025, 11, 5)));
    expect(short.unit).toBe("month");
    expect(short.buckets).toHaveLength(11);

    const long = getPeriodBuckets("all", getPeriodRange("all", 0, NOW, at(2022, 5, 1)));
    expect(long.unit).toBe("year");
    expect(long.buckets.map((b) => new Date(b.start).getFullYear())).toEqual([2022, 2023, 2024, 2025, 2026]);
  });
});
