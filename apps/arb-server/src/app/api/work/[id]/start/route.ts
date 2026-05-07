import { NextResponse } from "next/server";
import { handleStartWork } from "@/composition/queue";
import { getApiAuth } from "@/lib/auth";

interface StartBody {
  clientId: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!id || !body?.clientId) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  await handleStartWork({
    workItemId: id,
    clientId: body.clientId,
  });

  return new NextResponse(null, { status: 204 });
}
