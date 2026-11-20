import { useMemo } from "react";
import { PinFill, PinLine } from "@mingcute/react";
import type { DropdownMenuItem } from "@/shared/ui/DropdownMenu";
import { showToast } from "@/shared/ui";
import { useTranslation } from "@/languages";
import {
  useIsSidebarPinned,
  useSidebarPinsStore,
  type SidebarPin,
} from "../store/sidebarPinsStore";

/** "pin to sidebar" / "unpin from sidebar" entry for a playlist, album or artist menu */
export function useSidebarPinMenuItem(
  item: SidebarPin | null,
): DropdownMenuItem | null {
  const { t } = useTranslation();
  const pinned = useIsSidebarPinned(item?.kind, item?.id);
  // callers rebuild the item object on every render, so the memo keys on its fields
  const kind = item?.kind;
  const id = item?.id;
  const title = item?.title ?? "";
  const subtitle = item?.subtitle;
  const imageUrl = item?.imageUrl;
  const href = item?.href ?? "";

  return useMemo(() => {
    if (!kind || !id) return null;
    const pin: SidebarPin = { kind, id, title, subtitle, imageUrl, href };
    return {
      id: pinned ? "unpin-from-sidebar" : "pin-to-sidebar",
      label: pinned
        ? t("common.unpin_from_sidebar")
        : t("common.pin_to_sidebar"),
      icon: pinned ? <PinFill size={15} /> : <PinLine size={15} />,
      onClick: () => {
        const nowPinned = useSidebarPinsStore.getState().toggle(pin);
        showToast(
          nowPinned
            ? t("common.pinned_to_sidebar")
            : t("common.unpinned_from_sidebar"),
          "checkmark",
          {
            description: title,
          },
        );
      },
    };
  }, [kind, id, title, subtitle, imageUrl, href, pinned, t]);
}
