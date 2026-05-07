import { NextResponse } from "next/server";
import { handleFailWork } from "@/composition/queue";
import { getApiAuth } from "@/lib/auth";

interface FailBody {
  clientId: string;
  error: string;
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

  let body: FailBody;
  try {
    body = (await request.json()) as FailBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!id || !body?.clientId || !body?.error) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const result = await handleFailWork({
    workItemId: id,
    clientId: body.clientId,
    error: body.error,
  });

  return NextResponse.json(result);
}
