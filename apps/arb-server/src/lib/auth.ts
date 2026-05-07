import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Google-OAuth-backed authentication — copied from g2crowd/litellm-dashboard.
 *
 * Flow:
 *   1. User clicks "Sign in with Google" on /login → GET /api/auth/login
 *   2. We generate a random state + nonce, stash them in short-lived
 *      HttpOnly cookies, redirect to Google's consent screen.
 *   3. Google redirects to /api/auth/callback with ?code=&state=.
 *   4. Callback validates state, exchanges code for tokens, verifies the ID
 *      token signature, asserts email_verified, hd === "g2.com", and
 *      email domain. On success, sets a stateless session cookie.
 *
 * Session cookie format: <base64url(payloadJson)>.<base64url(hmacSha256)>
 * Payload: { "email": string, "exp": number (unix ms) }
 * HMAC keyed by SESSION_SECRET — rotating the secret invalidates all sessions.
 */

export const AUTH_COOKIE_NAME = "arb_session";
export const OAUTH_STATE_COOKIE = "arb_oauth_state";
export const OAUTH_NONCE_COOKIE = "arb_oauth_nonce";
export const OAUTH_NEXT_COOKIE = "arb_oauth_next";

export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const ALLOWED_EMAIL_DOMAIN = "g2.com";

export interface SessionPayload {
  email: string;
  exp: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}.`);
  }
  return value;
}

export function getOAuthConfig() {
  return {
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
  };
}

function getSessionSecret(): Buffer {
  return Buffer.from(requireEnv("SESSION_SECRET"), "utf8");
}

export function resolveBaseUrl(request: Request): string {
  const headers = request.headers;
  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto");
  if (forwardedHost) {
    const proto = forwardedProto ?? "https";
    const host = forwardedHost.split(",")[0].trim();
    return `${proto}://${host}`;
  }
  if (process.env.OAUTH_REDIRECT_BASE_URL) {
    return process.env.OAUTH_REDIRECT_BASE_URL;
  }
  return new URL(request.url).origin;
}

export function getRedirectUri(request: Request): string {
  return new URL("/api/auth/callback", resolveBaseUrl(request)).toString();
}

function toBase64Url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function hmac(input: string): Buffer {
  return createHmac("sha256", getSessionSecret()).update(input).digest();
}

export function generateRandomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

export function isAllowedEmail(email: string): boolean {
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2) return false;
  return parts[1] === ALLOWED_EMAIL_DOMAIN;
}

export function createSessionToken(
  email: string,
  now: number = Date.now(),
): { token: string; expiresAt: Date } {
  const payload: SessionPayload = {
    email,
    exp: now + SESSION_DURATION_MS,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = toBase64Url(hmac(payloadB64));
  return {
    token: `${payloadB64}.${signature}`,
    expiresAt: new Date(payload.exp),
  };
}

export function verifySessionToken(
  token: string | undefined,
  now: number = Date.now(),
): SessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const payloadB64 = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expectedSig = toBase64Url(hmac(payloadB64));
  const a = fromBase64Url(signature);
  const b = fromBase64Url(expectedSig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as SessionPayload).email !== "string" ||
    typeof (payload as SessionPayload).exp !== "number"
  ) {
    return null;
  }

  const { email, exp } = payload as SessionPayload;
  if (exp <= now) return null;
  if (!isAllowedEmail(email)) return null;

  return { email, exp };
}

/**
 * Check if the current request has a valid session.
 * In dev mode with DEV_BYPASS_AUTH=true, returns a fake session.
 */
export function getSession(request: Request): SessionPayload | null {
  if (
    process.env.DEV_BYPASS_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return { email: "dev@g2.com", exp: Date.now() + SESSION_DURATION_MS };
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${AUTH_COOKIE_NAME}=([^;]+)`));
  const token = match?.[1];
  return verifySessionToken(token);
}

/**
 * Check if the request has a valid Bearer token (for API clients like arb CLI).
 * For now, validates against the session token format.
 */
export function getApiAuth(request: Request): SessionPayload | null {
  if (
    process.env.DEV_BYPASS_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return { email: "dev@g2.com", exp: Date.now() + SESSION_DURATION_MS };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  return verifySessionToken(token);
}
