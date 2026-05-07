import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserSettingsStore, type UserConfig } from "@/composition/user-settings";

export async function GET(request: Request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = getUserSettingsStore();
  const settings = await store.getOrCreate(session.email);

  return NextResponse.json({
    email: settings.email,
    displayName: settings.displayName,
    config: settings.config,
    hasApiToken: settings.apiTokenHash !== null,
  });
}

export async function PUT(request: Request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let config: UserConfig;
  try {
    config = (await request.json()) as UserConfig;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const store = getUserSettingsStore();
  const settings = await store.updateConfig(session.email, config);

  return NextResponse.json({
    email: settings.email,
    config: settings.config,
  });
}
