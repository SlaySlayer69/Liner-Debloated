import { memo, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChartBarFill, LeftLine, RightLine } from "@mingcute/react";
import { api } from "@/shared/api";
import ScrollableRow from "@/shared/ui/ScrollableRow";
import { Tooltip } from "@/shared/ui";
import { useTranslation } from "@/languages";
import { useIsContentTransparent } from "@/features/settings/store/customizationStore";
import { PopularItemCard } from "@/features/home/ui/PopularTracksSection";
import type { PopularItem } from "@/features/home/hooks/usePopularTracks";
import { useListeningStats } from "../hooks/useListeningStats";
import { STATS_PERIODS, type BucketUnit, type PeriodRange, type StatsPeriod } from "../lib/periods";
import type { TopArtist } from "../lib/aggregate";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;
const ARTIST_IMAGE_LIMIT = 10;

type TFn = (key: string, vars?: Record<string, string | number>) => string;

function formatDuration(ms: number, t: TFn): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} ${t("collection.hr")} ${minutes} ${t("collection.min")}`;
  if (totalMinutes > 0) return `${minutes} ${t("collection.min")}`;
  return `${Math.round(ms / 1000)} ${t("collection.sec")}`;
}

function periodLabel(
  period: StatsPeriod,
  offset: number,
  range: PeriodRange,
  locale: string,
  t: TFn,
): string {
  const start = new Date(range.start);
  const thisYear = new Date().getFullYear();
  switch (period) {
    case "day":
      if (offset === 0) return t("home.stats.today");
      if (offset === 1) return t("home.stats.yesterday");
      return new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: start.getFullYear() === thisYear ? undefined : "numeric",
      }).format(start);
    case "week": {
      if (offset === 0) return t("home.stats.this_week");
      if (offset === 1) return t("home.stats.last_week");
      const last = new Date(range.end - 1);
      const fmt = new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: last.getFullYear() === thisYear ? undefined : "numeric",
      });
      return fmt.formatRange ? fmt.formatRange(start, last) : `${fmt.format(start)} – ${fmt.format(last)}`;
    }
    case "month":
      if (offset === 0) return t("home.stats.this_month");
      if (offset === 1) return t("home.stats.last_month");
      return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(start);
    case "year":
      if (offset === 0) return t("home.stats.this_year");
      if (offset === 1) return t("home.stats.last_year");
      return String(start.getFullYear());
    case "all":
      return t("home.stats.all_time");
  }
}

function bucketLabel(unit: BucketUnit, start: number, locale: string): string {
  const d = new Date(start);
  switch (unit) {
    case "hour":
      return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
    case "day":
      return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(d);
    case "month":
      return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(d);
    case "year":
      return String(d.getFullYear());
  }
}

function bucketTick(period: StatsPeriod, unit: BucketUnit, start: number, locale: string): string {
  const d = new Date(start);
  switch (unit) {
    case "hour":
      return String(d.getHours());
    case "day":
      return period === "week"
        ? new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d)
        : String(d.getDate());
    case "month":
      return new Intl.DateTimeFormat(locale, { month: "narrow" }).format(d);
    case "year":
      return String(d.getFullYear()).slice(2);
  }
}

// artist pictures are fetched once per session for the top few artists only
const artistImages = new Map<string, Promise<string | undefined>>();

function useArtistImages(artists: readonly TopArtist[]): Record<string, string> {
  const [images, setImages] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    for (const artist of artists.slice(0, ARTIST_IMAGE_LIMIT)) {
      if (!artist.id) continue;
      let pending = artistImages.get(artist.id);
      if (!pending) {
        pending = api.getArtistImage(artist.id).catch(() => undefined);
        artistImages.set(artist.id, pending);
      }
      const key = artist.key;
      void pending.then((url) => {
        if (!active || !url) return;
        setImages((prev) => (prev[key] === url ? prev : { ...prev, [key]: url }));
      });
    }
    return () => {
      active = false;
    };
  }, [artists]);
  return images;
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="px-8 mt-[18px] mb-0 text-[15px] font-semibold text-text-primary leading-tight tracking-tight"
      style={font}
    >
      {children}
    </h3>
  );
}

function StatisticsSection({ headingMarginTop = "mt-[22px]" }: { headingMarginTop?: string }) {
  const { t, locale } = useTranslation();
  const hasCustomBg = useIsContentTransparent();
  const [period, setPeriod] = useState<StatsPeriod>("week");
  const [offset, setOffset] = useState(0);
  const { isLoading, range, unit, buckets, summary, genres, hasOlder } = useListeningStats(period, offset);

  const artistImages = useArtistImages(summary?.topArtists ?? []);

  const trackItems = useMemo<PopularItem[]>(
    () =>
      (summary?.topTracks ?? []).map((entry) => ({
        type: "track",
        item: entry.track,
        playCount: entry.plays,
      })),
    [summary],
  );

  const artistItems = useMemo<PopularItem[]>(
    () =>
      (summary?.topArtists ?? []).map((artist) => ({
        type: "artist",
        item: {
          id: artist.id ?? "",
          name: artist.name,
          imageUrl: artistImages[artist.key] ?? artist.coverUrl ?? "",
          followers: artist.plays,
          description: "",
          totalListens: artist.plays,
          totalTracks: 0,
        },
        playCount: artist.plays,
      })),
    [summary, artistImages],
  );

  const maxBucket = useMemo(() => Math.max(0, ...(summary?.bucketMs ?? [0])), [summary]);
  const label = periodLabel(period, offset, range, locale, t);
  const tileClass = hasCustomBg ? "apple-glass-action" : "bg-bg-elevated";
  const hasData = Boolean(summary && summary.totalMs > 0);

  const playsCaption = (plays: number, ms: number) =>
    `${t("home.stats.plays_count", { count: plays })} · ${formatDuration(ms, t)}`;

  const tiles = [
    { id: "time", label: t("home.stats.listening_time"), value: formatDuration(summary?.totalMs ?? 0, t) },
    { id: "plays", label: t("home.stats.plays"), value: String(summary?.playCount ?? 0) },
    { id: "tracks", label: t("home.stats.tracks"), value: String(summary?.uniqueTracks ?? 0) },
    { id: "artists", label: t("home.stats.artists"), value: String(summary?.uniqueArtists ?? 0) },
  ];

  return (
    <section className="flex flex-col" aria-label={t("home.stats.title")}>
      <div className={`${headingMarginTop} px-8 flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center shrink-0">
            <ChartBarFill className="w-5 h-5 text-violet-400" />
          </div>
          <h2
            className="text-text-primary text-[21px] font-semibold m-0 leading-tight tracking-tight"
            style={font}
          >
            {t("home.stats.title")}
          </h2>
        </div>

        <div
          className="inline-flex items-center gap-[2px] rounded-xl p-[3px] bg-bg-elevated select-none"
          role="tablist"
          aria-label={t("home.stats.title")}
        >
          {STATS_PERIODS.map((value) => {
            const active = value === period;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setPeriod(value);
                  setOffset(0);
                }}
                className={`relative rounded-lg px-[12px] py-[6px] text-[12.5px] leading-none border-0 bg-transparent cursor-pointer transition-colors duration-150 active:scale-[0.97] ${
                  active ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
                }`}
                style={{ ...font, fontWeight: 500 }}
              >
                {active && (
                  <motion.div
                    layoutId="statsPeriodTab"
                    className="absolute inset-0 rounded-lg bg-bg-primary shadow-sm"
                    transition={{ type: "spring", stiffness: 500, damping: 35, mass: 0.7 }}
                  />
                )}
                <span className="relative z-10">{t(`home.stats.period_${value}`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-8 mt-[10px] flex items-center gap-1 select-none">
        {period !== "all" && (
          <button
            type="button"
            onClick={() => setOffset((o) => o + 1)}
            disabled={!hasOlder}
            aria-label={t("home.stats.previous")}
            className="h-[26px] w-[26px] rounded-md flex items-center justify-center border-0 bg-transparent text-text-secondary hover:text-text-primary hover:bg-border-alpha-14 disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
          >
            <LeftLine size={16} />
          </button>
        )}
        <span
          className={`text-[13.5px] font-medium text-text-primary ${period === "all" ? "" : "min-w-[96px] text-center"}`}
          style={font}
        >
          {label}
        </span>
        {period !== "all" && (
          <button
            type="button"
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
            disabled={offset === 0}
            aria-label={t("home.stats.next")}
            className="h-[26px] w-[26px] rounded-md flex items-center justify-center border-0 bg-transparent text-text-secondary hover:text-text-primary hover:bg-border-alpha-14 disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
          >
            <RightLine size={16} />
          </button>
        )}
      </div>

      <div className="px-8 mt-[10px] grid grid-cols-2 lg:grid-cols-4 gap-2">
        {tiles.map((tile) => (
          <div key={tile.id} className={`${tileClass} rounded-[6px] px-4 py-3 flex flex-col gap-1 min-w-0`}>
            <span className="text-[12px] text-text-tertiary truncate" style={font}>
              {tile.label}
            </span>
            <span
              className={`text-[22px] font-semibold text-text-primary leading-tight tabular-nums truncate transition-opacity duration-150 ${
                isLoading && !summary ? "opacity-40" : "opacity-100"
              }`}
              style={font}
            >
              {tile.value}
            </span>
          </div>
        ))}
      </div>

      {!isLoading && !hasData ? (
        <p className="px-8 mt-[14px] mb-0 text-[13px] text-text-tertiary" style={font}>
          {t("home.stats.empty")}
        </p>
      ) : (
        <>
          <div className={`mx-8 mt-2 ${tileClass} rounded-[6px] px-4 pt-3 pb-2`}>
            <span className="text-[12px] text-text-tertiary" style={font}>
              {t("home.stats.chart_label")}
            </span>
            <div
              className="mt-2 h-[96px] flex items-end gap-[2px]"
              role="img"
              aria-label={`${t("home.stats.chart_label")}: ${label}`}
            >
              {buckets.map((bucket, i) => {
                const ms = summary?.bucketMs[i] ?? 0;
                const height = maxBucket > 0 ? Math.max(ms > 0 ? 4 : 0, (ms / maxBucket) * 100) : 0;
                return (
                  <Tooltip
                    key={bucket.start}
                    side="top"
                    sideOffset={6}
                    content={`${bucketLabel(unit, bucket.start, locale)} · ${formatDuration(ms, t)}`}
                    wrapperClassName="flex-1 h-full flex items-end min-w-0"
                  >
                    <div className="group w-full h-full flex items-end cursor-default">
                      <div
                        className="w-full rounded-t-[4px] bg-violet-400/75 group-hover:bg-violet-400 transition-colors duration-100"
                        style={{ height: `${height}%` }}
                      />
                    </div>
                  </Tooltip>
                );
              })}
            </div>
            <div className="mt-1 flex gap-[2px]" aria-hidden="true">
              {buckets.map((bucket, i) => {
                // label every bar while they fit, otherwise every few
                const step = buckets.length > 16 ? Math.ceil(buckets.length / 8) : 1;
                return (
                  <span
                    key={bucket.start}
                    className="flex-1 min-w-0 text-center text-[10px] text-text-tertiary tabular-nums truncate"
                  >
                    {i % step === 0 ? bucketTick(period, unit, bucket.start, locale) : ""}
                  </span>
                );
              })}
            </div>
          </div>

          {trackItems.length > 0 && (
            <>
              <SubHeading>{t("home.stats.top_songs")}</SubHeading>
              <ScrollableRow className="flex gap-[28px] pl-8 pr-8 mt-[10px] overflow-x-auto pb-[2px]">
                {trackItems.map((item, index) => {
                  const entry = summary!.topTracks[index];
                  return (
                    <PopularItemCard
                      key={`stats-track-${item.item.id}`}
                      item={item}
                      index={index}
                      showRanks
                      caption={playsCaption(entry.plays, entry.listenedMs)}
                    />
                  );
                })}
              </ScrollableRow>
            </>
          )}

          {artistItems.length > 0 && (
            <>
              <SubHeading>{t("home.stats.top_artists")}</SubHeading>
              <ScrollableRow className="flex gap-[28px] pl-8 pr-8 mt-[10px] overflow-x-auto pb-[2px]">
                {artistItems.map((item, index) => {
                  const entry = summary!.topArtists[index];
                  return (
                    <PopularItemCard
                      key={`stats-artist-${entry.key}`}
                      item={item}
                      index={index}
                      caption={playsCaption(entry.plays, entry.listenedMs)}
                    />
                  );
                })}
              </ScrollableRow>
            </>
          )}

          <SubHeading>{t("home.stats.top_genres")}</SubHeading>
          <div className="px-8 mt-[10px]">
            {genres.length === 0 ? (
              <p className="m-0 text-[13px] text-text-tertiary" style={font}>
                {t("home.stats.genres_empty")}
              </p>
            ) : (
              <ol className="m-0 p-0 list-none grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2">
                {genres.map((genre, index) => (
                  <li key={genre.genre} className="flex items-center gap-3 min-w-0">
                    <span className="w-[18px] shrink-0 text-[12px] text-text-tertiary tabular-nums text-right">
                      {index + 1}
                    </span>
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13.5px] font-medium text-text-primary" style={font}>
                          {genre.genre}
                        </span>
                        <span className="shrink-0 text-[12px] text-text-tertiary tabular-nums">
                          {Math.round(genre.share * 100)}% · {formatDuration(genre.listenedMs, t)}
                        </span>
                      </div>
                      <div className="h-[6px] w-full rounded-full bg-border-alpha-14 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-400/80"
                          style={{ width: `${Math.max(2, genre.share * 100)}%` }}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default memo(StatisticsSection);
