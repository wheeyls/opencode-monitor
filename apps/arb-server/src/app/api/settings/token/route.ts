import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserSettingsStore } from "@/composition/user-settings";

export async function POST(request: Request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = getUserSettingsStore();
  const { token, settings } = await store.generateToken(session.email);

  return NextResponse.json({
    token,
    warning: "This token will only be shown once. Copy it now.",
  });
}
