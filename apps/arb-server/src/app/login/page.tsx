const ERROR_MESSAGES: Record<string, string> = {
  missing_code_or_state: "Missing OAuth code or state.",
  invalid_state: "OAuth state validation failed.",
  missing_nonce: "OAuth nonce is missing.",
  missing_id_token: "Google did not return an ID token.",
  invalid_id_token: "Failed to validate Google ID token.",
  invalid_nonce: "OAuth nonce validation failed.",
  email_not_verified: "Your Google email is not verified.",
  forbidden_domain: "Only g2.com accounts are allowed.",
  oauth_callback_failed: "Authentication failed. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? ERROR_MESSAGES[error] ?? "Login failed." : null;

  return (
    <section className="mx-auto max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h1 className="text-xl font-semibold">Sign in to arb</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Use your Google Workspace account ({"@"}g2.com) to continue.
      </p>

      {message ? (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {message}
        </div>
      ) : null}

      <a
        href="/api/auth/login"
        className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950"
      >
        Sign in with Google
      </a>
    </section>
  );
}
