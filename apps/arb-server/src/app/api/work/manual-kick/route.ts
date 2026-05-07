import { NextResponse } from "next/server";
import { handleManualKick } from "@/composition/queue";
import { getApiAuth } from "@/lib/auth";

interface ManualKickBody {
  affinityKey: string;
  message?: string;
}

export async function POST(request: Request) {
  const auth = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: ManualKickBody;
  try {
    body = (await request.json()) as ManualKickBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body?.affinityKey) {
    return NextResponse.json({ error: "missing_affinity_key" }, { status: 400 });
  }

  const result = await handleManualKick({
    userId: auth.email,
    affinityKey: body.affinityKey,
    message: body.message,
  });

  return NextResponse.json(result);
}
