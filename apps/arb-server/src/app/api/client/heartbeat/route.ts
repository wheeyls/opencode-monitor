import { NextResponse } from "next/server";
import { handleHeartbeatWork } from "@/composition/queue";
import { getApiAuth } from "@/lib/auth";

interface HeartbeatBody {
  workItemId: string;
  clientId: string;
}

export async function POST(request: Request) {
  const auth = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: HeartbeatBody;
  try {
    body = (await request.json()) as HeartbeatBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body?.workItemId || !body?.clientId) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  await handleHeartbeatWork({
    workItemId: body.workItemId,
    clientId: body.clientId,
  });

  return new NextResponse(null, { status: 204 });
}
