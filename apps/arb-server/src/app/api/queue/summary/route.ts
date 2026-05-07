import { NextResponse } from "next/server";
import { getQueueSummary } from "@/composition/dashboard-queries";
import { getApiAuth } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getQueueSummary());
}
