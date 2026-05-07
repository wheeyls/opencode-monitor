import { NextResponse } from "next/server";
import { handleClaimWork } from "@/composition/queue";
import { getApiAuth } from "@/lib/auth";

interface ClaimBody {
  clientId: string;
}

export async function POST(request: Request) {
  const auth = getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: ClaimBody;
  try {
    body = (await request.json()) as ClaimBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body?.clientId) {
    return NextResponse.json({ error: "missing_client_id" }, { status: 400 });
  }

  const result = await handleClaimWork({
    clientId: body.clientId,
    userId: auth.email,
  });

  if (result.kind === "none") {
    return NextResponse.json({ kind: "none" });
  }

  const { workItem } = result;
  return NextResponse.json({
    kind: "work",
    workItem: {
      id: workItem.id,
      threadId: workItem.threadId,
      kind: workItem.kind,
      sequence: workItem.sequence,
      payload: workItem.payload,
    },
    leaseExpiresAt: result.leaseExpiresAt.toISOString(),
    sessionRef: result.sessionRef,
  });
}
