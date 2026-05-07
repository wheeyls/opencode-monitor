import { OAuth2Client } from "google-auth-library";
import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  OAUTH_NEXT_COOKIE,
  OAUTH_NONCE_COOKIE,
  OAUTH_STATE_COOKIE,
  createSessionToken,
  getOAuthConfig,
  getRedirectUri,
  isAllowedEmail,
} from "@/lib/auth";

function redirectWithError(request: Request, code: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

function sanitizeNextPath(nextPath: string | undefined): string {
  if (!nextPath) return "/";
  if (!nextPath.startsWith("/")) return "/";
  if (nextPath.startsWith("//")) return "/";
  return nextPath;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  if (!code || !state) {
    return redirectWithError(request, "missing_code_or_state");
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const stateCookie = cookieHeader.match(new RegExp(`${OAUTH_STATE_COOKIE}=([^;]+)`))?.[1];
  const nonceCookie = cookieHeader.match(new RegExp(`${OAUTH_NONCE_COOKIE}=([^;]+)`))?.[1];
  const nextCookie = cookieHeader.match(new RegExp(`${OAUTH_NEXT_COOKIE}=([^;]+)`))?.[1];

  if (!stateCookie || stateCookie !== state) {
    return redirectWithError(request, "invalid_state");
  }
  if (!nonceCookie) {
    return redirectWithError(request, "missing_nonce");
  }

  try {
    const { clientId, clientSecret } = getOAuthConfig();
    const redirectUri = getRedirectUri(request);
    const oauthClient = new OAuth2Client(clientId, clientSecret, redirectUri);

    const tokenResponse = await oauthClient.getToken(code);
    const idToken = tokenResponse.tokens.id_token;
    if (!idToken) {
      return redirectWithError(request, "missing_id_token");
    }

    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      return redirectWithError(request, "invalid_id_token");
    }

    if (payload.nonce !== nonceCookie) {
      return redirectWithError(request, "invalid_nonce");
    }

    if (!payload.email || payload.email_verified !== true) {
      return redirectWithError(request, "email_not_verified");
    }

    if (payload.hd !== "g2.com" || !isAllowedEmail(payload.email)) {
      return redirectWithError(request, "forbidden_domain");
    }

    const { token, expiresAt } = createSessionToken(payload.email);
    const nextPath = sanitizeNextPath(nextCookie);
    const response = NextResponse.redirect(new URL(nextPath, request.url));

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });

    response.cookies.set({
      name: OAUTH_STATE_COOKIE,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });

    response.cookies.set({
      name: OAUTH_NONCE_COOKIE,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });

    response.cookies.set({
      name: OAUTH_NEXT_COOKIE,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });

    return response;
  } catch {
    return redirectWithError(request, "oauth_callback_failed");
  }
}
