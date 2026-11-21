import { useState, useEffect } from "react";
import PopularTracksSection from "./PopularTracksSection";
import HomePageSkeleton from "./HomePageSkeleton";
import { useRecentlyPlayed } from "../hooks/useRecentlyPlayed";
import { useMostSaved, usePopularAlbums } from "../hooks/useExploreCollections";
import { StatisticsSection } from "@/features/stats";
import { useTranslation } from "@/languages";
import Button from "@/shared/ui/Button";
import { usePageBackdrop } from "@/shared/lib";
import { AlbumFill, BookmarkFill, TimeFill } from "@mingcute/react";

export default function HomePage() {
  const [attempt, setAttempt] = useState(0);
  return <HomeFeed key={attempt} onRetry={() => setAttempt((n) => n + 1)} />;
}

function HomeFeed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();

  // no daily mixes, "listening right now" or "most listened of all time" on this home:
  // the listening statistics take their place below "jump back in"
  const { data: recentlyPlayed, isLoading: recentLoading } =
    useRecentlyPlayed(20);
  const { items: popularAlbums, isLoading: albumsLoading } = usePopularAlbums();
  const { items: mostSaved, isLoading: savedLoading } = useMostSaved();
  const firstAlbum = popularAlbums[0];
  const firstAlbumCover =
    firstAlbum?.type === "album" ? firstAlbum.item.coverUrl : undefined;
  const firstRecent = recentlyPlayed?.[0];
  usePageBackdrop(
    firstAlbumCover ||
      (firstRecent?.type === "track" || firstRecent?.type === "album"
        ? firstRecent.item.coverUrl
        : undefined) ||
      undefined,
  );

  const isDataLoading = recentLoading || albumsLoading || savedLoading;

  const isReady = !isDataLoading;
  const nothingLoaded =
    popularAlbums.length === 0 &&
    !recentlyPlayed?.length &&
    mostSaved.length === 0;
  const [skeletonExited, setSkeletonExited] = useState(() => !isDataLoading);

  useEffect(() => {
    if (isReady && !skeletonExited) {
      const timer = setTimeout(() => {
        setSkeletonExited(true);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isReady, skeletonExited]);

  return (
    // the header only sits on the right now, so the feed starts at the top:
    // the 36px "Your Mixes" row is centred on the sidebar logo (16px + 23px / 2)
    <div className="relative h-full w-full overflow-y-auto overflow-x-hidden bg-transparent pt-[var(--home-feed-top,10px)] pb-(--page-inset-bottom)">
      <div className="relative z-1 grid grid-cols-1 items-start w-full">
        {isReady && nothingLoaded && (
          <div className="col-start-1 row-start-1 flex min-h-[60vh] w-full flex-col items-center justify-center gap-[6px] px-[24px] text-center">
            <span className="text-title font-[600] text-text-primary">
              {t("home.load_failed")}
            </span>
            <span className="text-body text-text-secondary">
              {t("playlist.load_failed_desc")}
            </span>
            <Button
              variant="secondary"
              onClick={onRetry}
              className="mt-[10px] !h-[36px] !rounded-[10px] !border-0 px-[16px]"
            >
              {t("offline.try_again")}
            </Button>
          </div>
        )}

        {isReady && !nothingLoaded && (
          <div className="col-start-1 row-start-1 w-full pb-[16px]">
            {popularAlbums.length > 0 && (
              <PopularTracksSection
                title={t("home.popularAlbums")}
                icon={<AlbumFill />}
                items={popularAlbums}
                headingMarginTop="mt-0"
              />
            )}

            {recentlyPlayed && recentlyPlayed.length > 0 && (
              <PopularTracksSection
                title={t("home.jumpBackIn")}
                icon={<TimeFill />}
                items={recentlyPlayed}
                headingMarginTop={
                  popularAlbums.length > 0 ? "mt-[22px]" : "mt-0"
                }
              />
            )}

            <StatisticsSection headingMarginTop="mt-[22px]" />

            {mostSaved.length > 0 && (
              <PopularTracksSection
                title={t("home.mostSaved")}
                icon={<BookmarkFill />}
                items={mostSaved}
                headingMarginTop="mt-[22px]"
              />
            )}
          </div>
        )}

        {!skeletonExited && (
          <div
            className={`col-start-1 row-start-1 w-full z-10 transition-opacity duration-300 ease-out ${
              isReady
                ? "opacity-0 pointer-events-none"
                : "opacity-100 pointer-events-auto"
            }`}
            onTransitionEnd={(event) => {
              if (event.target === event.currentTarget) setSkeletonExited(true);
            }}
          >
            <HomePageSkeleton />
          </div>
        )}
      </div>
    </div>
  );
}
