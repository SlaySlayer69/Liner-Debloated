export type StatsPeriod = "day" | "week" | "month" | "year" | "all";

export const STATS_PERIODS: readonly StatsPeriod[] = ["day", "week", "month", "year", "all"];

export interface PeriodRange {
  start: number;
  // exclusive
  end: number;
}

export interface PeriodBucket {
  start: number;
  end: number;
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// weeks start on monday
function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const shift = (day.getDay() + 6) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - shift);
}

/**
 * Range of the period `offset` steps before the current one (0 = today / this week / ...).
 * "all" ignores the offset and spans from `earliest` up to now.
 */
export function getPeriodRange(
  period: StatsPeriod,
  offset: number,
  now: number = Date.now(),
  earliest: number | null = null,
): PeriodRange {
  const ref = new Date(now);
  switch (period) {
    case "day": {
      const d = startOfDay(ref);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      return { start: start.getTime(), end: end.getTime() };
    }
    case "week": {
      const w = startOfWeek(ref);
      const start = new Date(w.getFullYear(), w.getMonth(), w.getDate() - offset * 7);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      return { start: start.getTime(), end: end.getTime() };
    }
    case "month": {
      const start = new Date(ref.getFullYear(), ref.getMonth() - offset, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return { start: start.getTime(), end: end.getTime() };
    }
    case "year": {
      const start = new Date(ref.getFullYear() - offset, 0, 1);
      const end = new Date(start.getFullYear() + 1, 0, 1);
      return { start: start.getTime(), end: end.getTime() };
    }
    case "all": {
      const first = earliest ?? now;
      const start = new Date(new Date(first).getFullYear(), new Date(first).getMonth(), 1);
      return { start: start.getTime(), end: startOfDay(ref).getTime() + DAY_MS };
    }
  }
}

/** true when an older period of this kind can still contain data */
export function hasOlderPeriod(
  period: StatsPeriod,
  offset: number,
  earliest: number | null,
  now: number = Date.now(),
): boolean {
  if (period === "all" || earliest === null) return false;
  return getPeriodRange(period, offset, now).start > earliest;
}

export type BucketUnit = "hour" | "day" | "month" | "year";

export interface PeriodBuckets {
  unit: BucketUnit;
  buckets: PeriodBucket[];
}

/** chart buckets: hours of a day, days of a week / month, months of a year, months or years overall */
export function getPeriodBuckets(period: StatsPeriod, range: PeriodRange): PeriodBuckets {
  const buckets: PeriodBucket[] = [];
  const start = new Date(range.start);

  if (period === "day") {
    for (let h = 0; h < 24; h++) {
      const s = new Date(start.getFullYear(), start.getMonth(), start.getDate(), h);
      const e = new Date(start.getFullYear(), start.getMonth(), start.getDate(), h + 1);
      buckets.push({ start: s.getTime(), end: e.getTime() });
    }
    return { unit: "hour", buckets };
  }

  if (period === "week" || period === "month") {
    let cursor = start;
    while (cursor.getTime() < range.end) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      buckets.push({ start: cursor.getTime(), end: next.getTime() });
      cursor = next;
    }
    return { unit: "day", buckets };
  }

  const last = new Date(range.end - 1);
  const months =
    (last.getFullYear() - start.getFullYear()) * 12 + last.getMonth() - start.getMonth() + 1;

  // more than two years of history reads better per year
  if (period === "all" && months > 24) {
    for (let y = start.getFullYear(); y <= last.getFullYear(); y++) {
      buckets.push({ start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() });
    }
    return { unit: "year", buckets };
  }

  for (let i = 0; i < months; i++) {
    const s = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const e = new Date(start.getFullYear(), start.getMonth() + i + 1, 1);
    buckets.push({ start: s.getTime(), end: e.getTime() });
  }
  return { unit: "month", buckets };
}
