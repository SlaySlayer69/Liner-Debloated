import type { Track } from "@/shared/types";
import { showToast } from "@/shared/ui";
import { createTranslatorSync, getStoredLocale } from "@/languages";
import { log } from "@/shared/utils/logger";
import { playerEngine } from "./playerEngine";
import { loadCollectionTracks } from "./loadCollectionTracks";
import type { CollectionRadioSource } from "./collectionRadio";

/**
 * starts the radio of a playlist, album or artist from a menu; pages that already have the
 * songs pass them in, menus on cards let it load them
 */
export async function playCollectionRadio(
  source: CollectionRadioSource,
  options: { tracks?: Track[]; ownedPlaylist?: boolean } = {},
): Promise<void> {
  const t = createTranslatorSync(getStoredLocale());
  try {
    const tracks =
      options.tracks && options.tracks.length > 0
        ? options.tracks
        : await loadCollectionTracks(source.kind, source.id, options.ownedPlaylist);
    if (!playerEngine.startCollectionRadio(source, tracks)) {
      showToast(t("common.radio_empty"), "error", { description: source.title });
      return;
    }
    showToast(t("common.radio_started"), "checkmark", { description: source.title });
  } catch (error) {
    log("yellow", "radio", `collection radio failed: ${error instanceof Error ? error.message : String(error)}`);
    showToast(t("common.radio_failed"), "error", { description: source.title });
  }
}
