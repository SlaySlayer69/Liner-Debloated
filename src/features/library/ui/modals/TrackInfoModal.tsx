import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Dialog from "@/shared/ui/Dialog";
import CoverImage from "@/features/covers/ui/CoverImage";
import ExplicitBadge from "@/shared/ui/ExplicitBadge";
import { api } from "@/shared/api";
import { useTranslation } from "@/languages";
import { lookupItunesTrack, type ItunesTrackInfo } from "@/features/player/lib/itunesTrack";
import { lookupGenre } from "@/features/stats/lib/genres";
import { statsDb } from "@/features/stats/store/statsDb";
import { currentStatsOwner } from "@/features/stats/recorder";
import { summarizeTrackListens, type TrackListening } from "@/features/stats/lib/aggregate";
import { useModalStore, type TrackInfoDetail } from "../../store/modalStore";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

interface LoadedInfo {
  album?: { id?: string; title: string };
  releaseDate?: string;
  durationMs?: number;
  explicit?: boolean;
  genre?: string;
  itunes: ItunesTrackInfo | null;
  listening: TrackListening | null;
}

function formatClock(ms?: number): string | undefined {
  if (!ms) return undefined;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatRelease(value: string | undefined, locale: string): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(date);
}

async function loadInfo(detail: TrackInfoDetail): Promise<LoadedInfo> {
  const mainArtist = detail.artists.split(",")[0]?.trim() ?? "";
  const [details, itunes, artistGenre, records] = await Promise.all([
    api.getTrack(detail.id).catch(() => null),
    lookupItunesTrack(detail.title, detail.artists),
    mainArtist ? lookupGenre(mainArtist).catch(() => null) : Promise.resolve(null),
    statsDb.getRange(currentStatsOwner(), 0, Number.MAX_SAFE_INTEGER).catch(() => []),
  ]);
  return {
    album: details?.album?.title
      ? { id: details.album.id || undefined, title: details.album.title }
      : itunes?.album
        ? { title: itunes.album }
        : undefined,
    releaseDate: details?.releaseDate || itunes?.releaseDate,
    durationMs: details?.durationMs || detail.durationMs,
    explicit: details?.explicit ?? detail.explicit,
    // the song's own genre first, the artist's as a fallback
    genre: itunes?.genre || artistGenre || undefined,
    itunes,
    listening: summarizeTrackListens(records, detail.id),
  };
}

function Row({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[7px]">
      <dt className="shrink-0 text-[13px] text-text-tertiary" style={font}>
        {label}
      </dt>
      <dd
        className={`m-0 min-w-0 truncate text-right text-[13.5px] text-text-primary ${
          onClick ? "cursor-pointer hover:underline" : ""
        }`}
        style={font}
        onClick={onClick}
      >
        {children}
      </dd>
    </div>
  );
}

export default function TrackInfoModal() {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const open = useModalStore((state) => state.trackInfoOpen);
  const detail = useModalStore((state) => state.trackInfoDetail);
  const close = useModalStore((state) => state.closeTrackInfo);
  const [info, setInfo] = useState<LoadedInfo | null>(null);

  useEffect(() => {
    if (!open || !detail) return;
    let active = true;
    setInfo(null);
    void loadInfo(detail).then((loaded) => {
      if (active) setInfo(loaded);
    });
    return () => {
      active = false;
    };
  }, [open, detail]);

  const unknown = t("track_info.unknown");
  const loading = <span className="skeleton-shimmer inline-block h-[12px] w-[90px] rounded align-middle" />;
  const value = (text: string | undefined) => (info ? text || unknown : loading);

  const itunes = info?.itunes;
  const listening = info?.listening;
  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60_000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours} ${t("collection.hr")} ${minutes % 60} ${t("collection.min")}`;
    return `${minutes} ${t("collection.min")}`;
  };
  const formatWhen = (ts: number | null) =>
    ts === null
      ? t("track_info.never")
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)} maxWidth={420}>
      {detail && (
        <div className="flex flex-col px-[20px] pb-[20px]">
          <h3
            className="m-0 mb-[14px] text-[16px] font-[600] text-text-primary"
            style={{ ...font, letterSpacing: "-0.01em" }}
          >
            {t("track_info.title")}
          </h3>

          <div className="flex items-center gap-[14px]">
            <div className="relative h-[64px] w-[64px] shrink-0 overflow-hidden rounded-md bg-border-alpha-14">
              {detail.coverUrl && (
                <CoverImage src={detail.coverUrl} alt="" fill sizes="64px" className="object-cover" />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-[2px]">
              <span className="flex min-w-0 items-center gap-[6px] text-[15px] font-[600] text-text-primary" style={font}>
                <span className="truncate">{detail.title}</span>
                {(info?.explicit ?? detail.explicit) && <ExplicitBadge size="md" className="shrink-0" />}
              </span>
              <span className="truncate text-[13px] text-text-secondary" style={font}>
                {detail.artists}
              </span>
            </div>
          </div>

          <dl className="m-0 mt-[14px] flex flex-col divide-y divide-border-alpha-14">
            <Row label={t("track_info.genre")}>{value(info?.genre)}</Row>
            <Row
              label={t("track_info.album")}
              onClick={
                info?.album?.id
                  ? () => {
                      close();
                      navigate(`/collection?type=album&id=${encodeURIComponent(info.album!.id!)}`);
                    }
                  : undefined
              }
            >
              {value(info?.album?.title)}
            </Row>
            <Row label={t("track_info.released")}>{value(formatRelease(info?.releaseDate, locale))}</Row>
            <Row label={t("track_info.duration")}>{value(formatClock(info?.durationMs ?? detail.durationMs))}</Row>
            {itunes?.trackNumber && (
              <Row label={t("track_info.track_number")}>
                {itunes.trackCount
                  ? t("track_info.track_of", { n: itunes.trackNumber, total: itunes.trackCount })
                  : String(itunes.trackNumber)}
                {itunes.discCount && itunes.discCount > 1 && itunes.discNumber
                  ? ` · ${t("track_info.disc_of", { n: itunes.discNumber, total: itunes.discCount })}`
                  : ""}
              </Row>
            )}
            <Row label={t("track_info.explicit")}>
              {info ? ((info.explicit ?? detail.explicit) ? t("track_info.yes") : t("track_info.no")) : loading}
            </Row>
            <Row label={t("track_info.your_plays")}>{listening ? String(listening.plays) : loading}</Row>
            <Row label={t("track_info.listening_time")}>{listening ? formatTime(listening.listenedMs) : loading}</Row>
            <Row label={t("track_info.first_listened")}>
              {listening ? formatWhen(listening.firstListenedAt) : loading}
            </Row>
            <Row label={t("track_info.last_listened")}>
              {listening ? formatWhen(listening.lastListenedAt) : loading}
            </Row>
          </dl>

          <p className="m-0 mt-[12px] text-[11.5px] text-text-tertiary" style={font}>
            {t("track_info.source_note")}
          </p>
        </div>
      )}
    </Dialog>
  );
}
