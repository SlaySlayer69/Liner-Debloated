import { useEffect, useMemo, useState } from "react";
import { statsDb } from "../store/statsDb";
import { currentStatsOwner, ensureHistoryBackfill } from "../recorder";
import { summarize, summarizeGenres, type StatsSummary, type TopGenre } from "../lib/aggregate";
import {
  getPeriodBuckets,
  getPeriodRange,
  hasOlderPeriod,
  type PeriodBucket,
  type BucketUnit,
  type PeriodRange,
  type StatsPeriod,
} from "../lib/periods";
import { getCachedGenre, lookupGenres } from "../lib/genres";

// genres come from the artists that carry most of the listening time
const GENRE_ARTIST_LIMIT = 15;

export interface ListeningStats {
  isLoading: boolean;
  range: PeriodRange;
  unit: BucketUnit;
  buckets: PeriodBucket[];
  summary: StatsSummary | null;
  genres: TopGenre[];
  hasOlder: boolean;
}

export function useListeningStats(period: StatsPeriod, offset: number): ListeningStats {
  const owner = currentStatsOwner();
  const [revision, setRevision] = useState(0);
  const [earliest, setEarliest] = useState<number | null>(null);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [genreRevision, setGenreRevision] = useState(0);

  // new listens arrive while the page is open: refresh, but at most every few seconds
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = statsDb.subscribe(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setRevision((r) => r + 1);
      }, 1_500);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    void ensureHistoryBackfill(owner);
  }, [owner]);

  useEffect(() => {
    let active = true;
    void statsDb.getEarliest(owner).then((ts) => {
      if (active) setEarliest(ts);
    });
    return () => {
      active = false;
    };
  }, [owner, revision]);

  const now = Date.now();
  // the range only depends on the calendar day, not on every render's clock
  const dayKey = new Date(now).toDateString();
  const range = useMemo(
    () => getPeriodRange(period, offset, Date.now(), earliest),
    [period, offset, earliest, dayKey],
  );
  const { unit, buckets } = useMemo(() => getPeriodBuckets(period, range), [period, range]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    void statsDb.getRange(owner, range.start, range.end).then((records) => {
      if (!active) return;
      setSummary(summarize(records, buckets));
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [owner, range, buckets, revision]);

  const genreArtists = useMemo(
    () => summary?.topArtists.slice(0, GENRE_ARTIST_LIMIT) ?? [],
    [summary],
  );

  useEffect(() => {
    if (genreArtists.length === 0) return;
    let active = true;
    void lookupGenres(genreArtists.map((a) => a.name)).then(() => {
      if (active) setGenreRevision((r) => r + 1);
    });
    return () => {
      active = false;
    };
  }, [genreArtists]);

  const genres = useMemo(
    () => summarizeGenres(genreArtists, (artist) => getCachedGenre(artist.name)),
    [genreArtists, genreRevision],
  );

  return {
    isLoading,
    range,
    unit,
    buckets,
    summary,
    genres,
    hasOlder: hasOlderPeriod(period, offset, earliest, now),
  };
}
