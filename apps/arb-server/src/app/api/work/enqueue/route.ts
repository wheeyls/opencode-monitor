import { NextResponse } from "next/server";
import { handleIngestEvent } from "@/composition/queue";
import { getApiAuth } from "@/lib/auth";

interface EnqueueBody {
  affinityKey?: string;
  kind?: "event" | "manual_kick";
  payload?: Record<string, unknown>;
  dedupKey?: string;
  userId?: string;
  // Fields sent by ServerQueueDispatcher (flat event shape)
  source?: string;
  type?: string;
  key?: string;
  repo?: string;
  body?: string;
  url?: string;
  meta?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const auth = getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: EnqueueBody;
  try {
    raw = (await request.json()) as EnqueueBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const affinityKey = raw.affinityKey ?? raw.key;
  if (!affinityKey) {
    return NextResponse.json({ error: "missing_affinity_key" }, { status: 400 });
  }

  const payload = raw.payload ?? {
    source: raw.source,
    type: raw.type,
    key: raw.key,
    repo: raw.repo,
    body: raw.body,
    url: raw.url,
    meta: raw.meta,
  };

  const result = await handleIngestEvent({
    userId: raw.userId ?? auth.email,
    affinityKey,
    kind: raw.kind ?? "event",
    payload,
    dedupKey: raw.dedupKey,
  });

  return NextResponse.json(result);
}
