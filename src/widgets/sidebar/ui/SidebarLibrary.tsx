import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  DiscLine,
  DownLine,
  PinLine,
  PlaylistFill,
  UpLine,
  User1Line,
} from "@mingcute/react";
import DropdownMenu, { type DropdownMenuItem } from "@/shared/ui/DropdownMenu";
import {
  useSidebarPinsStore,
  type SidebarPin,
} from "@/features/navigation/store/sidebarPinsStore";
import { CoverCollage, usePlaylistsList } from "@/features/library";
import { useCachedTracksStore } from "@/features/library/cached";
import { useLikesCover } from "@/features/library/hooks/useLikesCover";
import { useSavedTracks } from "@/features/library/saved/hooks/useSavedTracks";
import cachedSongsCover from "@/assets/cached-songs-cover.svg";
import localFilesCover from "@/assets/local-files-cover.svg";
import { useOfflineModeStore } from "@/features/connectivity";
import CoverImage from "@/features/covers/ui/CoverImage";
import { useTranslation } from "@/languages";
import { Tooltip } from "@/shared/ui";

interface SidebarLibraryItem {
  key: string;
  title: string;
  href: string;
  cover: ReactNode;
  round?: boolean;
  menu?: DropdownMenuItem[];
}

function SvgCover({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="h-full w-full select-none object-cover"
    />
  );
}

function PlaylistCover({ urls, title }: { urls: string[]; title: string }) {
  if (urls.length >= 2)
    return <CoverCollage urls={urls} title={title} className="gap-0" />;
  if (urls.length === 1)
    return (
      <CoverImage
        src={urls[0]}
        alt={title}
        fill
        sizes="40px"
        className="object-cover transition-all duration-300 group-hover:brightness-[1.15]"
        draggable={false}
        unoptimized
      />
    );
  return <PlaylistFill size={20} className="text-border-alpha-33" />;
}

const PIN_FALLBACK_ICONS = {
  playlist: PlaylistFill,
  album: DiscLine,
  artist: User1Line,
} as const;

function PinCover({ pin }: { pin: SidebarPin }) {
  if (pin.imageUrl)
    return (
      <CoverImage
        src={pin.imageUrl}
        alt={pin.title}
        fill
        sizes="40px"
        className="object-cover transition-all duration-300 group-hover:brightness-[1.15]"
        draggable={false}
        unoptimized
      />
    );
  const Icon = PIN_FALLBACK_ICONS[pin.kind];
  return <Icon size={20} className="text-border-alpha-33" />;
}

// albums, artists and other people's playlists the user pinned; own playlists are
// listed anyway, so a pin of one would only show it twice
function usePinnedItems(): SidebarLibraryItem[] {
  const { t } = useTranslation();
  const pins = useSidebarPinsStore((state) => state.pins);
  return pins
    .map((pin, index) => ({ pin, index }))
    .filter(({ pin }) => !pin.href.startsWith("/library/playlist"))
    .map(({ pin, index }) => ({
      key: `pin:${pin.kind}:${pin.id}`,
      title: pin.subtitle ? `${pin.title} · ${pin.subtitle}` : pin.title,
      href: pin.href,
      round: pin.kind === "artist",
      cover: <PinCover pin={pin} />,
      menu: [
        ...(index > 0
          ? [
              {
                id: "move-up",
                label: t("common.move_up"),
                icon: <UpLine size={15} />,
                onClick: () =>
                  useSidebarPinsStore.getState().move(index, index - 1),
              },
            ]
          : []),
        ...(index < pins.length - 1
          ? [
              {
                id: "move-down",
                label: t("common.move_down"),
                icon: <DownLine size={15} />,
                onClick: () =>
                  useSidebarPinsStore.getState().move(index, index + 1),
              },
            ]
          : []),
        {
          id: "unpin",
          label: t("common.unpin_from_sidebar"),
          icon: <PinLine size={15} />,
          danger: true,
          onClick: () => useSidebarPinsStore.getState().unpin(pin.kind, pin.id),
        },
      ],
    }));
}

// fades the list edge only on the side that has more to scroll
function useScrollFade() {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 0;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setFade((prev) =>
        prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  const mask = `linear-gradient(to bottom, ${
    fade.top ? "transparent, black 16px" : "black"
  }, ${fade.bottom ? "black calc(100% - 16px), transparent" : "black"})`;

  return { ref, style: { maskImage: mask, WebkitMaskImage: mask } };
}

// 40px covers in the 52px nav panel: 6px from the sides and between covers,
// radius one step under the panel's so the corners nest
function SidebarLibraryList({ items }: { items: SidebarLibraryItem[] }) {
  const { pathname, search } = useLocation();
  const fade = useScrollFade();
  const current = pathname + search;
  const [menu, setMenu] = useState<{
    items: DropdownMenuItem[];
    x: number;
    y: number;
  } | null>(null);

  return (
    <>
      <div className="mx-auto h-px w-[26px] shrink-0 bg-border-alpha-14" />
      <div
        ref={fade.ref}
        style={fade.style}
        className="min-h-0 overflow-y-auto px-[6px] pt-[12px] pb-[6px]"
      >
        <div className="flex flex-col items-center gap-[6px]">
          {items.map((item) => (
            <Tooltip
              key={item.key}
              content={item.title}
              side="right"
              sideOffset={12}
            >
              <Link
                to={item.href}
                aria-label={item.title}
                aria-current={item.href === current ? "page" : undefined}
                onContextMenu={
                  item.menu
                    ? (e) => {
                        e.preventDefault();
                        setMenu({
                          items: item.menu!,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }
                    : undefined
                }
                className={`group relative h-[40px] w-[40px] shrink-0 overflow-hidden ${
                  item.round ? "rounded-full" : "rounded-control"
                } bg-border-alpha-14 flex items-center justify-center active:scale-[0.96] transition-transform duration-100`}
              >
                {item.cover}
              </Link>
            </Tooltip>
          ))}
        </div>
      </div>
      {menu && (
        <DropdownMenu
          trigger={<span />}
          items={menu.items}
          open
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
          position={{ x: menu.x, y: menu.y }}
        />
      )}
    </>
  );
}

function OnlineSidebarLibrary() {
  const { t } = useTranslation();
  const likesCover = useLikesCover();
  const showCached = useCachedTracksStore((state) => state.visibleOnline);
  const { data } = usePlaylistsList();
  const pinned = usePinnedItems();

  const items: SidebarLibraryItem[] = [
    {
      key: "likes",
      title: t("library.liked_songs"),
      href: "/library/playlist?id=likes",
      cover: <SvgCover src={likesCover} />,
    },
    ...(showCached
      ? [
          {
            key: "cached",
            title: t("library.cached.title"),
            href: "/library/cached",
            cover: <SvgCover src={cachedSongsCover} />,
          },
        ]
      : []),
    {
      key: "local",
      title: t("library.local.title"),
      href: "/library/local",
      cover: <SvgCover src={localFilesCover} />,
    },
    ...pinned,
    ...(data?.playlists ?? []).map((playlist) => ({
      key: `playlist:${playlist.id}`,
      title: playlist.title,
      href: `/library/playlist?id=${encodeURIComponent(playlist.id)}`,
      cover: (
        <PlaylistCover
          urls={
            playlist.coverUrls.length > 0
              ? playlist.coverUrls
              : playlist.coverUrl
                ? [playlist.coverUrl]
                : []
          }
          title={playlist.title}
        />
      ),
    })),
  ];

  return <SidebarLibraryList items={items} />;
}

function OfflineSidebarLibrary() {
  const { t } = useTranslation();
  const likesCover = useLikesCover();
  const { tracks: savedLikes, isLoading: savedLoading } = useSavedTracks();

  const items: SidebarLibraryItem[] = [
    ...(savedLikes.length > 0 || savedLoading
      ? [
          {
            key: "likes",
            title: t("library.liked_songs"),
            href: "/library/saved",
            cover: <SvgCover src={likesCover} />,
          },
        ]
      : []),
    {
      key: "cached",
      title: t("library.cached.title"),
      href: "/library/cached",
      cover: <SvgCover src={cachedSongsCover} />,
    },
    {
      key: "local",
      title: t("library.local.title"),
      href: "/library/local",
      cover: <SvgCover src={localFilesCover} />,
    },
  ];

  return <SidebarLibraryList items={items} />;
}

/** Library shortcuts under the nav group, same set and order as the library page. */
export function SidebarLibrary() {
  const offline = useOfflineModeStore((state) => state.offline);
  return offline ? <OfflineSidebarLibrary /> : <OnlineSidebarLibrary />;
}
