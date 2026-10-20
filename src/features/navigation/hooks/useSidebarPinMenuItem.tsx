import { useMemo } from "react";
import { PinFill, PinLine } from "@mingcute/react";
import type { DropdownMenuItem } from "@/shared/ui/DropdownMenu";
import { showToast } from "@/shared/ui";
import { useTranslation } from "@/languages";
import { useIsSidebarPinned, useSidebarPinsStore, type SidebarPin } from "../store/sidebarPinsStore";

/** "pin to sidebar" / "unpin from sidebar" entry for a playlist, album or artist menu */
export function useSidebarPinMenuItem(item: SidebarPin | null): DropdownMenuItem | null {
  const { t } = useTranslation();
  const pinned = useIsSidebarPinned(item?.kind, item?.id);

  return useMemo(() => {
    if (!item || !item.id) return null;
    return {
      id: pinned ? "unpin-from-sidebar" : "pin-to-sidebar",
      label: pinned ? t("common.unpin_from_sidebar") : t("common.pin_to_sidebar"),
      icon: pinned ? <PinFill size={15} /> : <PinLine size={15} />,
      onClick: () => {
        const nowPinned = useSidebarPinsStore.getState().toggle(item);
        showToast(nowPinned ? t("common.pinned_to_sidebar") : t("common.unpinned_from_sidebar"), "checkmark", {
          description: item.title,
        });
      },
    };
    // the item object is rebuilt on every render by callers, its fields are what matters
  }, [item?.kind, item?.id, item?.title, item?.subtitle, item?.imageUrl, item?.href, pinned, t]);
}
