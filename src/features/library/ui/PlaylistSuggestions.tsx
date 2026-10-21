import { memo, useCallback, useState } from "react";
import { Refresh1Line, SparklesFill } from "@mingcute/react";
import SongCardWithMenu from "@/features/player/ui/SongCardWithMenu";
import { playerEngine } from "@/features/player";
import { useToast } from "@/shared/ui";
import { ApiError } from "@/shared/api";
import type { Track } from "@/shared/types";
import { useTranslation } from "@/languages";
import { useAddPlaylistTracks } from "../hooks/useLibraryMutations";
import { usePlaylistSuggestions } from "../hooks/usePlaylistSuggestions";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

function formatDuration(ms: number): string | undefined {
  if (!ms) return undefined;
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
}

interface PlaylistSuggestionsProps {
  playlistId: string;
  playlistTitle: string;
  tracks: readonly Track[];
}

/** similar songs under an own playlist: click plays one, double-click adds it */
function PlaylistSuggestions({ playlistId, playlistTitle, tracks }: PlaylistSuggestionsProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { items, isLoading, failed, reload, remove } = usePlaylistSuggestions(playlistId, tracks);
  const addTrack = useAddPlaylistTracks();
  const [adding, setAdding] = useState<string | null>(null);

  const handleAdd = useCallback(
    async (track: Track) => {
      if (adding) return;
      setAdding(track.id);
      try {
        await addTrack.mutateAsync({ playlistId, trackId: track.id });
        remove(track.id);
        toast(t("common.added_to_playlist"), "checkmark", {
          description: `${track.title} → ${playlistTitle}`,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          remove(track.id);
          toast(t("common.track_already_in_playlist"), "error", { description: track.title });
        } else {
          toast(t("common.failed_add_playlist"), "error");
        }
      } finally {
        setAdding(null);
      }
    },
    [adding, addTrack, playlistId, playlistTitle, remove, toast, t],
  );

  if (tracks.length === 0) return null;

  return (
    <section className="mt-[28px] px-[8px]" aria-label={t("playlist.suggestions_title")}>
      <div className="flex items-center justify-between gap-3 px-[8px]">
        <div className="flex min-w-0 flex-col gap-[2px]">
          <h3
            className="m-0 flex items-center gap-2 text-[17px] font-semibold leading-tight tracking-tight text-text-primary"
            style={font}
          >
            <SparklesFill size={17} className="text-amber-400 shrink-0" />
            {t("playlist.suggestions_title")}
          </h3>
          <p className="m-0 text-[12.5px] text-text-tertiary" style={font}>
            {t("playlist.suggestions_hint")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={isLoading}
          className="inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2.5 text-[13px] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50 cursor-pointer"
          style={font}
        >
          <Refresh1Line size={15} className={isLoading ? "animate-spin" : ""} />
          {t("playlist.suggestions_reload")}
        </button>
      </div>

      <div className="mt-[8px] flex flex-col">
        {items.length === 0 && isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex h-[64px] items-center gap-[14px] px-[8px]">
              <div className="skeleton-shimmer h-[48px] w-[48px] shrink-0 rounded-md" />
              <div className="flex flex-1 flex-col gap-[6px]">
                <div className="skeleton-shimmer h-[13px] w-[35%] rounded" />
                <div className="skeleton-shimmer h-[11px] w-[20%] rounded" />
              </div>
            </div>
          ))}

        {items.length === 0 && !isLoading && (
          <p className="m-0 px-[8px] py-3 text-[13px] text-text-tertiary" style={font}>
            {failed ? t("playlist.suggestions_failed") : t("playlist.suggestions_empty")}
          </p>
        )}

        {items.map((track) => (
          <div
            key={track.id}
            className={`h-[64px] transition-opacity ${isLoading || adding === track.id ? "opacity-50" : ""}`}
          >
            <SongCardWithMenu
              id={track.id}
              title={track.title}
              artists={track.artists}
              artistId={track.artistId}
              artistList={track.artistList}
              coverUrl={track.coverUrl}
              duration={formatDuration(track.durationMs)}
              durationMs={track.durationMs}
              explicit={track.explicit}
              onPlay={() => void playerEngine.playTrack(track, [track], `${track.title} Radio`, track.coverUrl)}
              onDoubleClick={() => void handleAdd(track)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export default memo(PlaylistSuggestions);
