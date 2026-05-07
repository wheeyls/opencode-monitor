import { NextResponse } from "next/server";
import { handleCompleteWork } from "@/composition/queue";
import { getApiAuth } from "@/lib/auth";

interface CompleteBody {
  clientId: string;
  sessionRef?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: CompleteBody;
  try {
    body = (await request.json()) as CompleteBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!id || !body?.clientId) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  await handleCompleteWork({
    workItemId: id,
    clientId: body.clientId,
    sessionRef: body.sessionRef,
  });

  return new NextResponse(null, { status: 204 });
}
