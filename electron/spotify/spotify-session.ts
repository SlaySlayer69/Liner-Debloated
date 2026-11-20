import {
  SPOTIFY_REDIRECT_URI,
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  isSpotifyClientId,
  parseCallback,
  type CallbackResult,
} from "./pkce.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
// refresh a little early so a request started now never carries an expired token
const EXPIRY_MARGIN_MS = 60_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface SpotifyCipher {
  available: () => boolean;
  encrypt: (plain: string) => Buffer;
  decrypt: (data: Buffer) => string;
}

export interface SpotifyFiles {
  read: () => Buffer | null;
  write: (data: Buffer) => void;
  remove: () => void;
}

/** the loopback listener for the redirect; resolves with the first request that decides the sign-in */
export type CallbackListener = (
  decide: (requestUrl: string) => CallbackResult,
) => { result: Promise<CallbackResult>; close: () => void };

export interface SpotifySessionDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  cipher: SpotifyCipher;
  files: SpotifyFiles;
  openExternal: (url: string) => void;
  listen: CallbackListener;
  now?: () => number;
}

interface StoredSession {
  clientId: string;
  refreshToken: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export type SpotifyConnectResult = { ok: true } | { ok: false; error: string };

export class SpotifySession {
  private stored: StoredSession | null = null;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string | null> | null = null;
  private pendingSignIn: { close: () => void } | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: SpotifySessionDeps) {
    this.now = deps.now ?? Date.now;
    this.stored = this.load();
  }

  status(): { connected: boolean; clientId: string | null } {
    return {
      connected: Boolean(this.stored),
      clientId: this.stored?.clientId ?? null,
    };
  }

  /** opens spotify's consent page in the browser and waits for the redirect */
  async connect(clientId: string): Promise<SpotifyConnectResult> {
    if (!isSpotifyClientId(clientId))
      return { ok: false, error: "invalid_client_id" };
    this.pendingSignIn?.close();

    const pkce = createPkcePair();
    const state = createState();
    const listener = this.deps.listen((requestUrl) =>
      parseCallback(requestUrl, state),
    );
    this.pendingSignIn = listener;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<CallbackResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ kind: "error", error: "timeout" }),
        SIGN_IN_TIMEOUT_MS,
      );
    });

    try {
      this.deps.openExternal(
        buildAuthorizeUrl({
          clientId: clientId.trim(),
          challenge: pkce.challenge,
          state,
        }),
      );
      const callback = await Promise.race([listener.result, timeout]);
      if (callback.kind !== "code") {
        return {
          ok: false,
          error: callback.kind === "error" ? callback.error : "cancelled",
        };
      }
      const tokens = await this.requestToken({
        grant_type: "authorization_code",
        code: callback.code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        client_id: clientId.trim(),
        code_verifier: pkce.verifier,
      });
      if (!tokens.refresh_token)
        return { ok: false, error: "no_refresh_token" };
      this.stored = {
        clientId: clientId.trim(),
        refreshToken: tokens.refresh_token,
      };
      this.remember(tokens);
      this.save();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "sign_in_failed",
      };
    } finally {
      clearTimeout(timer);
      listener.close();
      if (this.pendingSignIn === listener) this.pendingSignIn = null;
    }
  }

  disconnect(): void {
    this.pendingSignIn?.close();
    this.stored = null;
    this.accessToken = null;
    this.expiresAt = 0;
    this.deps.files.remove();
  }

  /** a valid access token, refreshed when it is about to expire; null when not connected */
  async getAccessToken(): Promise<string | null> {
    if (!this.stored) return null;
    if (this.accessToken && this.now() < this.expiresAt - EXPIRY_MARGIN_MS)
      return this.accessToken;
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async refresh(): Promise<string | null> {
    const stored = this.stored;
    if (!stored) return null;
    try {
      const tokens = await this.requestToken({
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
        client_id: stored.clientId,
      });
      // spotify may rotate the refresh token; keep the newest one
      if (
        tokens.refresh_token &&
        tokens.refresh_token !== stored.refreshToken
      ) {
        this.stored = { ...stored, refreshToken: tokens.refresh_token };
        this.save();
      }
      this.remember(tokens);
      return this.accessToken;
    } catch (error) {
      // a revoked grant cannot recover: forget it so the settings show "not connected"
      if (error instanceof Error && error.message === "invalid_grant")
        this.disconnect();
      return null;
    }
  }

  private remember(tokens: TokenResponse) {
    this.accessToken = tokens.access_token;
    this.expiresAt = this.now() + Math.max(0, tokens.expires_in) * 1000;
  }

  private async requestToken(
    body: Record<string, string>,
  ): Promise<TokenResponse> {
    const response = await this.deps.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    const data = (await response.json().catch(() => null)) as
      (Partial<TokenResponse> & { error?: string }) | null;
    if (!response.ok || !data?.access_token) {
      throw new Error(data?.error || `token_request_failed_${response.status}`);
    }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in ?? 3600,
    };
  }

  private load(): StoredSession | null {
    try {
      const raw = this.deps.files.read();
      if (!raw || !this.deps.cipher.available()) return null;
      const parsed = JSON.parse(
        this.deps.cipher.decrypt(raw),
      ) as Partial<StoredSession>;
      return isSpotifyClientId(parsed.clientId) &&
        typeof parsed.refreshToken === "string" &&
        parsed.refreshToken
        ? { clientId: parsed.clientId, refreshToken: parsed.refreshToken }
        : null;
    } catch {
      return null;
    }
  }

  private save() {
    // without os encryption the refresh token only lives in memory for this run
    if (!this.stored || !this.deps.cipher.available()) return;
    try {
      this.deps.files.write(
        this.deps.cipher.encrypt(JSON.stringify(this.stored)),
      );
    } catch {}
  }
}
