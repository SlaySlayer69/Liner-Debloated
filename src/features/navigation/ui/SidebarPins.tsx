import { memo, useCallback, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { PinLine, PlaylistFill, DiscLine, User1Line, UpLine, DownLine } from "@mingcute/react";
import CoverImage from "@/features/covers/ui/CoverImage";
import DropdownMenu, { type DropdownMenuItem } from "@/shared/ui/DropdownMenu";
import { Tooltip } from "@/shared/ui";
import { useTranslation } from "@/languages";
import { useSidebarPinsStore, type SidebarPin } from "../store/sidebarPinsStore";

const FALLBACK_ICONS = {
  playlist: PlaylistFill,
  album: DiscLine,
  artist: User1Line,
} as const;

function PinnedEntry({
  pin,
  index,
  count,
  active,
}: {
  pin: SidebarPin;
  index: number;
  count: number;
  active: boolean;
}) {
  const { t } = useTranslation();
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const rounded = pin.kind === "artist" ? "rounded-full" : "rounded-[6px]";
  const Fallback = FALLBACK_ICONS[pin.kind];

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const menuItems: DropdownMenuItem[] = [
    ...(index > 0
      ? [
          {
            id: "move-up",
            label: t("common.move_up"),
            icon: <UpLine size={15} />,
            onClick: () => useSidebarPinsStore.getState().move(index, index - 1),
          },
        ]
      : []),
    ...(index < count - 1
      ? [
          {
            id: "move-down",
            label: t("common.move_down"),
            icon: <DownLine size={15} />,
            onClick: () => useSidebarPinsStore.getState().move(index, index + 1),
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
  ];

  return (
    <>
      <Tooltip
        content={pin.subtitle ? `${pin.title} · ${pin.subtitle}` : pin.title}
        side="right"
        sideOffset={12}
        disabled={menuPosition !== null}
      >
        <Link
          to={pin.href}
          aria-label={pin.title}
          aria-current={active ? "page" : undefined}
          onContextMenu={handleContextMenu}
          className={`group relative flex h-[36px] w-[36px] shrink-0 items-center justify-center overflow-hidden ${rounded} bg-border-alpha-14 active:scale-[0.96] transition-[transform,opacity,box-shadow] duration-100 ${
            active
              ? "opacity-100 ring-2 ring-text-primary/70 ring-offset-0"
              : "opacity-80 hover:opacity-100"
          }`}
        >
          {pin.imageUrl ? (
            <CoverImage
              src={pin.imageUrl}
              alt=""
              fill
              sizes="36px"
              className="object-cover"
              draggable={false}
            />
          ) : (
            <Fallback size={18} className="text-text-secondary" />
          )}
        </Link>
      </Tooltip>
      <DropdownMenu
        trigger={<span />}
        items={menuItems}
        open={menuPosition !== null}
        onOpenChange={(open) => {
          if (!open) setMenuPosition(null);
        }}
        position={menuPosition}
      />
    </>
  );
}

function isActiveHref(href: string, pathname: string, search: string): boolean {
  const [hrefPath, hrefQuery = ""] = href.split("?");
  if (hrefPath !== pathname) return false;
  const want = new URLSearchParams(hrefQuery);
  const have = new URLSearchParams(search);
  for (const [key, value] of want) {
    if (have.get(key) !== value) return false;
  }
  return true;
}

function SidebarPins() {
  const pins = useSidebarPinsStore((s) => s.pins);
  const { pathname, search } = useLocation();

  if (pins.length === 0) return null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center pt-[22px]">
      <div className="mb-[14px] h-px w-[26px] shrink-0 bg-border-alpha-14" aria-hidden="true" />
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-[12px] overflow-y-auto overflow-x-hidden pt-[2px] pb-[8px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {pins.map((pin, index) => (
          <PinnedEntry
            key={`${pin.kind}:${pin.id}`}
            pin={pin}
            index={index}
            count={pins.length}
            active={isActiveHref(pin.href, pathname, search)}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(SidebarPins);
