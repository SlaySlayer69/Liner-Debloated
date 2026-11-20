import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SPOTIFY_REDIRECT_URI,
  buildAuthorizeUrl,
  createPkcePair,
  isSpotifyClientId,
  parseCallback,
  type CallbackResult,
} from "./pkce";
import { SpotifySession, type SpotifySessionDeps } from "./spotify-session";

const CLIENT_ID = "0123456789abcdef0123456789abcdef";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function harness(overrides: Partial<SpotifySessionDeps> = {}) {
  let stored: Buffer | null = null;
  let now = 1_000_000;
  let pending: {
    decide: (url: string) => CallbackResult;
    resolve: (r: CallbackResult) => void;
  } | null = null;
  const opened: string[] = [];
  const deps: SpotifySessionDeps = {
    fetch: vi.fn(),
    cipher: {
      available: () => true,
      encrypt: (plain) => Buffer.from(`enc:${plain}`),
      decrypt: (data) => data.toString().replace(/^enc:/, ""),
    },
    files: {
      read: () => stored,
      write: (data) => {
        stored = data;
      },
      remove: () => {
        stored = null;
      },
    },
    openExternal: (url) => opened.push(url),
    listen: (decide) => {
      let resolve!: (r: CallbackResult) => void;
      const result = new Promise<CallbackResult>((r) => (resolve = r));
      pending = { decide, resolve };
      return {
        result,
        close: () => resolve({ kind: "error", error: "cancelled" }),
      };
    },
    now: () => now,
    ...overrides,
  };
  return {
    deps,
    opened,
    stored: () => stored,
    advance: (ms: number) => {
      now += ms;
    },
    /** what the browser would request after the user clicks "agree" */
    redirect: (query: (state: string) => string) => {
      const state = new URL(opened[opened.length - 1]).searchParams.get(
        "state",
      )!;
      const outcome = pending!.decide(`/callback?${query(state)}`);
      pending!.resolve(outcome);
    },
  };
}

describe("pkce helpers", () => {
  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = createPkcePair();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it("asks for read-only library scopes on the loopback redirect", () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: CLIENT_ID, challenge: "c", state: "s" }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.spotify.com/authorize",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(SPOTIFY_REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("user-library-read");
    expect(url.searchParams.get("scope")).not.toMatch(/modify/);
  });

  it("only accepts the redirect with the right state", () => {
    expect(parseCallback("/callback?code=abc&state=s1", "s1")).toEqual({
      kind: "code",
      code: "abc",
    });
    expect(parseCallback("/callback?code=abc&state=other", "s1")).toEqual({
      kind: "error",
      error: "state_mismatch",
    });
    expect(
      parseCallback("/callback?error=access_denied&state=s1", "s1"),
    ).toEqual({ kind: "error", error: "access_denied" });
    expect(parseCallback("/favicon.ico", "s1")).toEqual({ kind: "ignore" });
  });

  it("checks the client id format", () => {
    expect(isSpotifyClientId(CLIENT_ID)).toBe(true);
    expect(isSpotifyClientId("nope")).toBe(false);
  });
});

describe("SpotifySession", () => {
  it("signs in, stores the refresh token encrypted and hands out the access token", async () => {
    const h = harness();
    vi.mocked(h.deps.fetch).mockResolvedValueOnce(
      json({ access_token: "a1", refresh_token: "r1", expires_in: 3600 }),
    );
    const session = new SpotifySession(h.deps);

    const connecting = session.connect(CLIENT_ID);
    h.redirect((state) => `code=the-code&state=${state}`);
    await expect(connecting).resolves.toEqual({ ok: true });

    const body = new URLSearchParams(
      String(vi.mocked(h.deps.fetch).mock.calls[0][1].body),
    );
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBeTruthy();
    expect(h.stored()?.toString()).toContain("enc:");
    expect(await session.getAccessToken()).toBe("a1");
    expect(session.status()).toEqual({ connected: true, clientId: CLIENT_ID });

    // a restart reads the stored session back
    expect(new SpotifySession(h.deps).status().connected).toBe(true);
  });

  it("refreshes an expiring token once, keeping a rotated refresh token", async () => {
    const h = harness();
    vi.mocked(h.deps.fetch).mockResolvedValueOnce(
      json({ access_token: "a1", refresh_token: "r1", expires_in: 3600 }),
    );
    const session = new SpotifySession(h.deps);
    const connecting = session.connect(CLIENT_ID);
    h.redirect((state) => `code=c&state=${state}`);
    await connecting;

    h.advance(3600_000 - 30_000);
    vi.mocked(h.deps.fetch).mockResolvedValueOnce(
      json({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }),
    );
    const [first, second] = await Promise.all([
      session.getAccessToken(),
      session.getAccessToken(),
    ]);
    expect([first, second]).toEqual(["a2", "a2"]);
    expect(h.deps.fetch).toHaveBeenCalledTimes(2);
    const body = new URLSearchParams(
      String(vi.mocked(h.deps.fetch).mock.calls[1][1].body),
    );
    expect(body.get("refresh_token")).toBe("r1");
    expect(h.stored()?.toString()).toContain("r2");
  });

  it("forgets a revoked grant", async () => {
    const h = harness();
    vi.mocked(h.deps.fetch).mockResolvedValueOnce(
      json({ access_token: "a1", refresh_token: "r1", expires_in: 1 }),
    );
    const session = new SpotifySession(h.deps);
    const connecting = session.connect(CLIENT_ID);
    h.redirect((state) => `code=c&state=${state}`);
    await connecting;

    h.advance(120_000);
    vi.mocked(h.deps.fetch).mockResolvedValueOnce(
      json({ error: "invalid_grant" }, 400),
    );
    expect(await session.getAccessToken()).toBeNull();
    expect(session.status().connected).toBe(false);
    expect(h.stored()).toBeNull();
  });

  it("reports a declined consent and a bad client id", async () => {
    const h = harness();
    const session = new SpotifySession(h.deps);
    const connecting = session.connect(CLIENT_ID);
    h.redirect((state) => `error=access_denied&state=${state}`);
    await expect(connecting).resolves.toEqual({
      ok: false,
      error: "access_denied",
    });
    await expect(session.connect("not-a-client-id")).resolves.toEqual({
      ok: false,
      error: "invalid_client_id",
    });
    expect(h.deps.fetch).not.toHaveBeenCalled();
  });
});
