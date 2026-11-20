import { useEffect, useMemo, useState } from "react";
import {
  AlbumFill,
  HeartFill,
  MicFill,
  Playlist2Fill,
  Refresh2Fill,
  SpotifyFill,
  TimeFill,
} from "@mingcute/react";
import { useTranslation } from "@/languages";
import { cn } from "@/shared/lib";
import {
  AccountCard,
  ConfirmPill,
  MenuSelect,
  TextInput,
  ToggleSwitch,
  accountCardActionClassName,
} from "@/shared/ui";
import { AppImage } from "@/features/covers";
import {
  SPOTIFY_REDIRECT_URI,
  SYNC_INTERVAL_OPTIONS,
  createSpotifyClient,
  syncSpotifyNow,
  useSpotifyAccount,
  useSpotifySyncStore,
  type PlaylistSyncMode,
  type SpotifyPlaylist,
} from "@/features/spotify-sync";
import { SettingBlock, SettingRow, SettingSection } from "../controls";

const SPOTIFY_DASHBOARD = "https://developer.spotify.com/dashboard";
const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

function useSpotifyPlaylists(connected: boolean) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    createSpotifyClient()
      .playlists()
      .then((items) => {
        if (cancelled) return;
        setPlaylists(items);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, version]);

  return {
    playlists: connected ? playlists : null,
    failed,
    reload: () => setVersion((v) => v + 1),
  };
}

function formatTime(timestamp: number, locale: string) {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SpotifyTab({ searchQuery }: { searchQuery?: string }) {
  const { t, locale } = useTranslation();
  const account = useSpotifyAccount();
  const settings = useSpotifySyncStore((s) => s.settings);
  const updateSettings = useSpotifySyncStore((s) => s.updateSettings);
  const togglePlaylist = useSpotifySyncStore((s) => s.togglePlaylist);
  const running = useSpotifySyncStore((s) => s.running);
  const progress = useSpotifySyncStore((s) => s.progress);
  const lastResult = useSpotifySyncStore((s) => s.lastResult);
  const { playlists, failed, reload } = useSpotifyPlaylists(account.connected);

  const [clientId, setClientId] = useState(settings.clientId);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const searching = Boolean(searchQuery?.trim());
  const clientIdValid = CLIENT_ID_PATTERN.test(clientId.trim());

  const connect = async () => {
    if (!clientIdValid) return;
    updateSettings({ clientId: clientId.trim() });
    setConnecting(true);
    setConnectError(null);
    const result = await account.connect(clientId.trim());
    setConnecting(false);
    if (!result.ok) {
      setConnectError(result.error);
      return;
    }
    void syncSpotifyNow({ force: true });
  };

  const selected = useMemo(
    () => new Set(settings.selectedPlaylists),
    [settings.selectedPlaylists],
  );
  const disabled = !account.connected;

  const errorText = (code: string) =>
    code === "access_denied"
      ? t("settings.spotify.error_denied")
      : code === "timeout"
        ? t("settings.spotify.error_timeout")
        : code === "not_connected"
          ? t("settings.spotify.error_not_connected")
          : t("settings.spotify.error_generic", { code });

  const resultText = () => {
    if (running) {
      if (progress?.startsWith("playlist:"))
        return t("settings.spotify.progress_playlist", {
          name: progress.slice("playlist:".length),
        });
      return t("settings.spotify.progress_running");
    }
    if (!lastResult) return t("settings.spotify.never_synced");
    const time = formatTime(lastResult.finishedAt, locale);
    if (lastResult.error) return `${time} · ${errorText(lastResult.error)}`;
    if (lastResult.skipped)
      return t("settings.spotify.result_unchanged", { time });
    return t("settings.spotify.result", {
      time,
      added: lastResult.added,
      removed: lastResult.removed,
      unmatched: lastResult.unmatched,
    });
  };

  return (
    <div className="flex flex-col gap-[28px]">
      {!searching && (
        <AccountCard
          media={
            account.profile?.images?.[0]?.url ? (
              <AppImage src={account.profile.images[0].url} alt="" fill />
            ) : undefined
          }
          placeholderIcon={<SpotifyFill size={18} />}
          loading={account.loading}
          title={
            account.connected
              ? account.profile?.display_name ||
                account.profile?.id ||
                "Spotify"
              : t("settings.spotify.signed_out_title")
          }
          subtitle={
            connecting
              ? t("settings.spotify.waiting_for_browser")
              : connectError
                ? errorText(connectError)
                : account.connected
                  ? t("settings.spotify.signed_in_subtitle")
                  : t("settings.spotify.signed_out_description")
          }
          action={
            account.connected ? (
              <ConfirmPill
                label={t("settings.spotify.sign_out")}
                actionLabel={t("settings.spotify.sign_out")}
                confirmLabel={t("common.confirm") || "Confirm"}
                onConfirm={() => void account.disconnect()}
              />
            ) : (
              <button
                type="button"
                onClick={() => void connect()}
                disabled={!clientIdValid || connecting}
                className={cn(
                  accountCardActionClassName,
                  "bg-text-primary/85 text-bg-primary hover:bg-text-primary",
                )}
              >
                {t("settings.spotify.sign_in")}
              </button>
            )
          }
        />
      )}

      {!account.connected && (
        <SettingSection label={t("settings.spotify.section_app")}>
          <SettingBlock
            title={t("settings.spotify.client_id.title")}
            description={t("settings.spotify.client_id.description")}
            titleKey="settings.spotify.client_id.title"
            descKey="settings.spotify.client_id.description"
            searchQuery={searchQuery}
          >
            <TextInput
              size="sm"
              value={clientId}
              spellCheck={false}
              placeholder="0123456789abcdef0123456789abcdef"
              hasError={clientId.trim().length > 0 && !clientIdValid}
              onChange={(event) => setClientId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void connect();
              }}
            />
            <ol className="m-0 flex list-decimal flex-col gap-[4px] pl-[18px] text-caption leading-[17px] text-text-tertiary">
              <li>
                {t("settings.spotify.setup_step_1")}{" "}
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-text-secondary underline hover:text-text-primary"
                  onClick={() =>
                    window.open(SPOTIFY_DASHBOARD, "_blank", "noopener")
                  }
                >
                  developer.spotify.com
                </button>
              </li>
              <li>
                {t("settings.spotify.setup_step_2")}{" "}
                <code className="select-text rounded-[4px] bg-fill px-[4px] text-text-secondary">
                  {SPOTIFY_REDIRECT_URI}
                </code>
              </li>
              <li>{t("settings.spotify.setup_step_3")}</li>
              <li>{t("settings.spotify.setup_step_4")}</li>
            </ol>
          </SettingBlock>
        </SettingSection>
      )}

      <SettingSection label={t("settings.spotify.section_what")}>
        <SettingRow
          title={t("settings.spotify.liked.title")}
          description={t("settings.spotify.liked.description")}
          titleKey="settings.spotify.liked.title"
          descKey="settings.spotify.liked.description"
          icon={<HeartFill size={20} />}
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={settings.liked}
              onChange={(liked) => updateSettings({ liked })}
            />
          }
        />
        <SettingRow
          title={t("settings.spotify.albums.title")}
          description={t("settings.spotify.albums.description")}
          titleKey="settings.spotify.albums.title"
          descKey="settings.spotify.albums.description"
          icon={<AlbumFill size={20} />}
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={settings.albums}
              onChange={(albums) => updateSettings({ albums })}
            />
          }
        />
        <SettingRow
          title={t("settings.spotify.artists.title")}
          description={t("settings.spotify.artists.description")}
          titleKey="settings.spotify.artists.title"
          descKey="settings.spotify.artists.description"
          icon={<MicFill size={20} />}
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={settings.artists}
              onChange={(artists) => updateSettings({ artists })}
            />
          }
        />
        <SettingRow
          title={t("settings.spotify.playlists.title")}
          description={t("settings.spotify.playlists.description")}
          titleKey="settings.spotify.playlists.title"
          descKey="settings.spotify.playlists.description"
          icon={<Playlist2Fill size={20} />}
          searchQuery={searchQuery}
          control={
            <MenuSelect<PlaylistSyncMode>
              aria-label={t("settings.spotify.playlists.title")}
              className="w-[170px]"
              value={settings.playlistsMode}
              onChange={(playlistsMode) => updateSettings({ playlistsMode })}
              options={[
                { value: "none", label: t("settings.spotify.playlists.none") },
                {
                  value: "selected",
                  label: t("settings.spotify.playlists.selected"),
                },
                { value: "all", label: t("settings.spotify.playlists.all") },
              ]}
            />
          }
        />
      </SettingSection>

      {settings.playlistsMode === "selected" && !searching && (
        <SettingSection
          label={t("settings.spotify.section_playlists")}
          action={
            account.connected ? (
              <button
                type="button"
                onClick={reload}
                aria-label={t("settings.spotify.reload_playlists")}
                className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-text-tertiary hover:text-text-primary"
              >
                <Refresh2Fill size={16} />
              </button>
            ) : undefined
          }
        >
          <div className="flex max-h-[320px] flex-col overflow-y-auto px-[8px] py-[4px]">
            {disabled ? (
              <p className="m-0 px-[8px] py-[10px] text-caption text-text-tertiary">
                {t("settings.spotify.playlists_sign_in_first")}
              </p>
            ) : failed ? (
              <p className="m-0 px-[8px] py-[10px] text-caption text-text-tertiary">
                {t("settings.spotify.playlists_failed")}
              </p>
            ) : !playlists ? (
              <p className="m-0 px-[8px] py-[10px] text-caption text-text-tertiary">
                {t("common.loading") || "…"}
              </p>
            ) : playlists.length === 0 ? (
              <p className="m-0 px-[8px] py-[10px] text-caption text-text-tertiary">
                {t("settings.spotify.playlists_empty")}
              </p>
            ) : (
              playlists.map((playlist) => (
                <label
                  key={playlist.id}
                  className="flex cursor-pointer items-center gap-[10px] rounded-control px-[8px] py-[6px] hover:bg-fill"
                >
                  <input
                    type="checkbox"
                    className="size-[15px] cursor-pointer accent-[var(--color-text-primary)]"
                    checked={selected.has(playlist.id)}
                    onChange={(event) =>
                      togglePlaylist(playlist.id, event.target.checked)
                    }
                  />
                  <span className="relative size-[32px] shrink-0 overflow-hidden rounded-[6px] bg-fill">
                    {playlist.images?.[0]?.url ? (
                      <AppImage src={playlist.images[0].url} alt="" fill />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-label text-text-primary">
                      {playlist.name}
                    </span>
                    <span className="truncate text-caption text-text-tertiary">
                      {[
                        playlist.owner?.display_name,
                        playlist.tracks?.total !== undefined
                          ? t("settings.spotify.track_count", {
                              count: playlist.tracks.total,
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </SettingSection>
      )}

      <SettingSection label={t("settings.spotify.section_auto")}>
        <SettingRow
          title={t("settings.spotify.auto_sync.title")}
          description={t("settings.spotify.auto_sync.description")}
          titleKey="settings.spotify.auto_sync.title"
          descKey="settings.spotify.auto_sync.description"
          icon={<TimeFill size={20} />}
          searchQuery={searchQuery}
          control={
            <div className="flex items-center gap-[10px]">
              <MenuSelect<string>
                aria-label={t("settings.spotify.interval")}
                className="w-[130px]"
                value={String(settings.intervalMinutes)}
                disabled={!settings.autoSync}
                onChange={(value) =>
                  updateSettings({ intervalMinutes: Number(value) })
                }
                options={SYNC_INTERVAL_OPTIONS.map((minutes) => ({
                  value: String(minutes),
                  label: t("settings.spotify.every_minutes", {
                    count: minutes,
                  }),
                }))}
              />
              <ToggleSwitch
                checked={settings.autoSync}
                onChange={(autoSync) => updateSettings({ autoSync })}
              />
            </div>
          }
        />
        <SettingRow
          title={t("settings.spotify.sync_now")}
          description={resultText()}
          titleKey="settings.spotify.sync_now"
          icon={<Refresh2Fill size={20} />}
          searchQuery={searchQuery}
          control={
            <button
              type="button"
              disabled={disabled || running}
              onClick={() => void syncSpotifyNow({ force: true })}
              className={cn(
                accountCardActionClassName,
                "bg-fill text-text-primary hover:bg-fill-hover",
              )}
            >
              {running
                ? t("settings.spotify.syncing")
                : t("settings.spotify.sync_now_button")}
            </button>
          }
        />
      </SettingSection>
    </div>
  );
}
