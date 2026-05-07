import { cookies } from "next/headers";
import {
  getActiveClients,
  getQueueSummary,
  getRecentItems,
} from "@/composition/dashboard-queries";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);
  const authBypassed =
    process.env.DEV_BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production";

  if (!session && !authBypassed) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-xl font-semibold">Sign in required</h1>
        <p className="mt-2 text-sm text-zinc-400">
          You must sign in with your G2 account to view the arb dashboard.
        </p>
        <a
          href="/login"
          className="mt-4 inline-flex rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950"
        >
          Go to login
        </a>
      </section>
    );
  }

  const summary = await getQueueSummary();
  const clients = await getActiveClients();
  const items = await getRecentItems();

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Queue dashboard</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Signed in as {(session?.email ?? "dev@g2.com").toLowerCase()}
            </p>
          </div>
          <form action="/api/logout" method="post">
            <button
              type="submit"
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Logout
            </button>
          </form>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        {Object.entries(summary).map(([key, value]) => (
          <div
            key={key}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
          >
            <p className="text-xs uppercase tracking-wide text-zinc-400">{key}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">Clients</h2>
        {clients.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No registered clients.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-zinc-400">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Client ID</th>
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">User</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="border-t border-zinc-800">
                    <td className="py-2 pr-4 font-mono text-xs">{client.id}</td>
                    <td className="py-2 pr-4">{client.name}</td>
                    <td className="py-2 pr-4">{client.userId}</td>
                    <td className="py-2 pr-4">{client.status}</td>
                    <td className="py-2 pr-4">{client.lastSeenAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">Recent work items</h2>
        {items.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No work items yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-zinc-800 bg-zinc-950 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
                        {item.source ?? "unknown"}
                      </span>
                      {item.type && (
                        <span className="text-xs text-zinc-500">{item.type}</span>
                      )}
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(item.status)}`}>
                        {item.status}
                      </span>
                      {item.attemptCount > 1 && (
                        <span className="text-xs text-amber-400">
                          attempt {item.attemptCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-sm text-zinc-200">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {item.affinityKey}
                        </a>
                      ) : (
                        item.affinityKey
                      )}
                    </p>
                    {item.body && (
                      <p className="mt-1 text-sm text-zinc-400">{item.body}</p>
                    )}
                    {item.lastError && (
                      <p className="mt-1 text-sm text-red-400">{item.lastError}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-zinc-500">
                    <p>{new Date(item.createdAt).toLocaleString()}</p>
                    {item.claimedByClientId && (
                      <p className="mt-1">client: {item.claimedByClientId}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "pending": return "bg-yellow-900/50 text-yellow-300";
    case "claimed": return "bg-blue-900/50 text-blue-300";
    case "in_progress": return "bg-blue-900/50 text-blue-300";
    case "completed": return "bg-green-900/50 text-green-300";
    case "failed": return "bg-red-900/50 text-red-300";
    case "dead": return "bg-zinc-700 text-zinc-400";
    default: return "bg-zinc-800 text-zinc-300";
  }
}
