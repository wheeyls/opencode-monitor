import { NextResponse } from "next/server";
import { handleRegisterClient } from "@/composition/queue";
import { getApiAuth } from "@/lib/auth";

interface RegisterClientBody {
  name: string;
  capabilities?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const auth = getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: RegisterClientBody;
  try {
    body = (await request.json()) as RegisterClientBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body?.name) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }

  const result = await handleRegisterClient({
    userId: auth.email,
    name: body.name,
    capabilities: body.capabilities,
  });

  return NextResponse.json(result);
}
