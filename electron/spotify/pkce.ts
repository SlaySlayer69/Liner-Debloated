import { createHash, randomBytes } from "node:crypto";

// spotify sign-in with pkce: no client secret is shipped, the user's own spotify app
// (client id) redirects back to a loopback port the app listens on for the code

export const SPOTIFY_REDIRECT_PORT = 43821;
export const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_REDIRECT_PORT}/callback`;
export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-follow-read",
];

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(random = randomBytes): PkcePair {
  const verifier = base64Url(random(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createState(random = randomBytes): string {
  return base64Url(random(16));
}

export function buildAuthorizeUrl(options: {
  clientId: string;
  challenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: options.challenge,
    state: options.state,
    scope: SPOTIFY_SCOPES.join(" "),
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

export type CallbackResult =
  | { kind: "code"; code: string }
  | { kind: "error"; error: string }
  | { kind: "ignore" };

/** the loopback request spotify redirects to; anything else (favicon, wrong state) is ignored */
export function parseCallback(
  requestUrl: string,
  expectedState: string,
): CallbackResult {
  let url: URL;
  try {
    url = new URL(requestUrl, SPOTIFY_REDIRECT_URI);
  } catch {
    return { kind: "ignore" };
  }
  if (url.pathname !== "/callback") return { kind: "ignore" };
  if (url.searchParams.get("state") !== expectedState) {
    return { kind: "error", error: "state_mismatch" };
  }
  const error = url.searchParams.get("error");
  if (error) return { kind: "error", error };
  const code = url.searchParams.get("code");
  return code
    ? { kind: "code", code }
    : { kind: "error", error: "missing_code" };
}

/** spotify client ids are 32 hex characters */
export function isSpotifyClientId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/i.test(value.trim());
}
