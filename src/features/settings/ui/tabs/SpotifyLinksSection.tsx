import { useState } from "react";
import { AlbumFill, CloseLine, Playlist2Fill } from "@mingcute/react";
import { useTranslation } from "@/languages";
import { cn } from "@/shared/lib";
import { TextInput, accountCardActionClassName } from "@/shared/ui";
import {
  UnsupportedLinkError,
  publicSpotifySource,
  resolveSpotifyLink,
  syncSpotifyNow,
  useSpotifySyncStore,
} from "@/features/spotify-sync";
import { SettingSection } from "../controls";

/** public playlists and albums followed by link: works without a spotify sign-in */
export function SpotifyLinksSection() {
  const { t } = useTranslation();
  const links = useSpotifySyncStore((s) => s.settings.linkedSources);
  const addLinkedSource = useSpotifySyncStore((s) => s.addLinkedSource);
  const removeLinkedSource = useSpotifySyncStore((s) => s.removeLinkedSource);
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const trimmed = url.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setError(null);
    try {
      const { kind, id } = await resolveSpotifyLink(trimmed);
      if (links.some((link) => link.id === id)) {
        setError(t("settings.spotify.links.duplicate"));
        return;
      }
      // read it once now, so a private or broken link fails here and not silently later
      const item = await publicSpotifySource.read(kind, id);
      addLinkedSource({
        kind,
        id,
        url: trimmed,
        title: item.title || t("settings.spotify.links.untitled"),
      });
      setUrl("");
      void syncSpotifyNow();
    } catch (caught) {
      setError(
        caught instanceof UnsupportedLinkError
          ? t("settings.spotify.links.unsupported")
          : t("settings.spotify.links.unreadable"),
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <SettingSection label={t("settings.spotify.links.title")}>
      <div className="flex flex-col gap-[10px] px-[16px] py-[10px]">
        <span className="max-w-[460px] text-pretty text-caption leading-[17px] text-text-tertiary">
          {t("settings.spotify.links.description")}
        </span>
        <div className="flex items-center gap-[8px]">
          <TextInput
            size="sm"
            className="flex-1"
            value={url}
            spellCheck={false}
            placeholder="https://open.spotify.com/playlist/…"
            hasError={Boolean(error)}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void add();
            }}
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={!url.trim() || checking}
            className={cn(
              accountCardActionClassName,
              "bg-text-primary/85 text-bg-primary hover:bg-text-primary",
            )}
          >
            {checking
              ? t("settings.spotify.links.checking")
              : t("settings.spotify.links.add")}
          </button>
        </div>
        {error && <span className="text-caption text-red-400">{error}</span>}
        {links.length > 0 && (
          <ul className="m-0 flex list-none flex-col p-0">
            {links.map((link) => (
              <li
                key={link.id}
                className="group flex items-center gap-[10px] rounded-control px-[6px] py-[6px] hover:bg-fill"
              >
                <span className="flex shrink-0 text-text-tertiary">
                  {link.kind === "album" ? (
                    <AlbumFill size={16} />
                  ) : (
                    <Playlist2Fill size={16} />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-label text-text-primary">
                    {link.title}
                  </span>
                  <span className="truncate text-caption text-text-tertiary">
                    {link.kind === "album"
                      ? t("settings.spotify.links.kind_album")
                      : t("settings.spotify.links.kind_playlist")}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={t("settings.spotify.links.remove")}
                  title={t("settings.spotify.links.remove")}
                  onClick={() => removeLinkedSource(link.id)}
                  className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-text-tertiary opacity-0 transition-opacity hover:bg-fill-hover hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <CloseLine size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingSection>
  );
}
