import { NextResponse } from "next/server";
import {
  OAUTH_NEXT_COOKIE,
  OAUTH_NONCE_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  generateRandomToken,
  getOAuthConfig,
  getRedirectUri,
} from "@/lib/auth";

export async function GET(request: Request) {
  const { clientId } = getOAuthConfig();
  const state = generateRandomToken();
  const nonce = generateRandomToken();

  const requestUrl = new URL(request.url);
  const next = requestUrl.searchParams.get("next") ?? "/";

  const redirectUri = getRedirectUri(request);
  const oauthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  oauthUrl.searchParams.set("client_id", clientId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("scope", "openid email profile");
  oauthUrl.searchParams.set("state", state);
  oauthUrl.searchParams.set("nonce", nonce);
  oauthUrl.searchParams.set("hd", "g2.com");
  oauthUrl.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(oauthUrl);
  const expires = new Date(Date.now() + OAUTH_STATE_TTL_MS);

  response.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });

  response.cookies.set({
    name: OAUTH_NONCE_COOKIE,
    value: nonce,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });

  response.cookies.set({
    name: OAUTH_NEXT_COOKIE,
    value: next,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });

  return response;
}
