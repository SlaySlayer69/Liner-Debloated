import { app, net, safeStorage, shell } from "electron";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { handleTrusted } from "../ipc-guard.js";
import { SPOTIFY_REDIRECT_PORT } from "./pkce.js";
import { SpotifySession, type CallbackListener } from "./spotify-session.js";
import type { CallbackResult } from "./pkce.js";

function callbackPage(connected: boolean): string {
  const text = connected
    ? "Liner ist jetzt mit Spotify verbunden. Du kannst diesen Tab schließen.<br>Liner is now connected to Spotify. You can close this tab."
    : "Die Verbindung mit Spotify wurde abgebrochen.<br>Connecting to Spotify was cancelled.";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Liner</title></head>
<body style="font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;line-height:1.6">
<p>${text}</p></body></html>`;
}

const listenOnLoopback: CallbackListener = (decide) => {
  let settle!: (result: CallbackResult) => void;
  const result = new Promise<CallbackResult>((resolve) => {
    settle = resolve;
  });
  const server = http.createServer((req, res) => {
    const outcome = decide(req.url ?? "/");
    if (outcome.kind === "ignore") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(callbackPage(outcome.kind === "code"));
    settle(outcome);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    settle({
      kind: "error",
      error: error.code === "EADDRINUSE" ? "port_in_use" : "listen_failed",
    });
  });
  server.listen(SPOTIFY_REDIRECT_PORT, "127.0.0.1");
  return {
    result,
    close: () => {
      server.close();
      settle({ kind: "error", error: "cancelled" });
    },
  };
};

export function registerSpotifyIpc(): SpotifySession {
  const file = path.join(
    app.getPath("userData"),
    "auth",
    "spotify-session.json",
  );
  const session = new SpotifySession({
    fetch: (url, init) => net.fetch(url, init),
    cipher: {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (data) => safeStorage.decryptString(data),
    },
    files: {
      read: () => (fs.existsSync(file) ? fs.readFileSync(file) : null),
      write: (data) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data, { mode: 0o600 });
      },
      remove: () => fs.rmSync(file, { force: true }),
    },
    openExternal: (url) => void shell.openExternal(url),
    listen: listenOnLoopback,
  });

  handleTrusted("spotify:status", () => session.status());
  handleTrusted("spotify:connect", (_event, clientId: unknown) =>
    session.connect(typeof clientId === "string" ? clientId : ""),
  );
  handleTrusted("spotify:disconnect", () => {
    session.disconnect();
    return true;
  });
  handleTrusted("spotify:access-token", () => session.getAccessToken());
  return session;
}
