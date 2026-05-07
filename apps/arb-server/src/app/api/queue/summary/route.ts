import { NextResponse } from "next/server";
import { getQueueSummary } from "@/composition/queue";
import { getApiAuth } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(getQueueSummary());
}
