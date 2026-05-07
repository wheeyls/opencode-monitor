"use client";

import { useEffect, useState } from "react";

interface UserConfig {
  org?: string;
  owner?: string;
  repos?: string[];
  triggerPhrases?: string[];
  jira?: {
    baseUrl?: string;
    email?: string;
    jql?: string;
  };
}

interface SettingsResponse {
  email: string;
  displayName: string;
  config: UserConfig;
  hasApiToken: boolean;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [org, setOrg] = useState("");
  const [owner, setOwner] = useState("");
  const [repos, setRepos] = useState("");
  const [triggerPhrases, setTriggerPhrases] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraJql, setJiraJql] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: SettingsResponse) => {
        setSettings(data);
        const c = data.config;
        setOrg(c.org ?? "");
        setOwner(c.owner ?? "");
        setRepos((c.repos ?? []).join("\n"));
        setTriggerPhrases((c.triggerPhrases ?? []).join(", "));
        setJiraBaseUrl(c.jira?.baseUrl ?? "");
        setJiraEmail(c.jira?.email ?? "");
        setJiraJql(c.jira?.jql ?? "");
      });
  }, []);

  async function saveConfig() {
    setSaving(true);
    setSaved(false);
    setError(null);

    const config: UserConfig = {
      org: org || undefined,
      owner: owner || undefined,
      repos: repos.split("\n").map((r) => r.trim()).filter(Boolean),
      triggerPhrases: triggerPhrases.split(",").map((p) => p.trim()).filter(Boolean),
      jira: (jiraBaseUrl || jiraEmail || jiraJql)
        ? {
            baseUrl: jiraBaseUrl || undefined,
            email: jiraEmail || undefined,
            jql: jiraJql || undefined,
          }
        : undefined,
    };

    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });

    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError("Failed to save settings");
    }
  }

  async function generateToken() {
    setNewToken(null);
    const res = await fetch("/api/settings/token", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setNewToken(data.token);
      setSettings((prev) => prev ? { ...prev, hasApiToken: true } : prev);
    } else {
      setError("Failed to generate token");
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">{settings.email}</p>
      </section>

      {/* API Token */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">API Token</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Use this token as <code className="rounded bg-zinc-800 px-1">arbServerToken</code> in your CLI config.
        </p>

        {newToken && (
          <div className="mt-4 rounded-md border border-amber-700 bg-amber-950/50 p-4">
            <p className="text-sm font-medium text-amber-300">
              Copy this token now — it won&apos;t be shown again.
            </p>
            <pre className="mt-2 select-all break-all rounded bg-zinc-950 p-3 font-mono text-sm text-zinc-100">
              {newToken}
            </pre>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={generateToken}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200"
          >
            {settings.hasApiToken ? "Regenerate Token" : "Generate Token"}
          </button>
          {settings.hasApiToken && !newToken && (
            <span className="text-sm text-zinc-400">Token is set</span>
          )}
        </div>
      </section>

      {/* Config */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">Monitoring Config</h2>
        <p className="mt-1 text-sm text-zinc-400">
          These settings override values from arb.json when the server polls on your behalf.
        </p>

        <div className="mt-6 space-y-4">
          <Field label="GitHub Org" value={org} onChange={setOrg} placeholder="g2crowd" />
          <Field label="GitHub Owner (your username)" value={owner} onChange={setOwner} placeholder="wheeyls" />
          <TextArea
            label="Repos to watch (one per line)"
            value={repos}
            onChange={setRepos}
            placeholder={"g2crowd/ue\ng2crowd/buyer_intent_api"}
            rows={4}
          />
          <Field
            label="Trigger phrases (comma-separated)"
            value={triggerPhrases}
            onChange={setTriggerPhrases}
            placeholder="/ai, ai:"
          />

          <div className="border-t border-zinc-800 pt-4">
            <h3 className="text-sm font-medium text-zinc-300">Jira</h3>
            <div className="mt-3 space-y-4">
              <Field label="Base URL" value={jiraBaseUrl} onChange={setJiraBaseUrl} placeholder="https://g2crowd.atlassian.net" />
              <Field label="Email" value={jiraEmail} onChange={setJiraEmail} placeholder="mike@g2.com" />
              <Field label="JQL" value={jiraJql} onChange={setJiraJql} placeholder="parent = LABS-918 AND status != Done ORDER BY updated DESC" />
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={saveConfig}
            disabled={saving}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {saved && <span className="text-sm text-green-400">Saved</span>}
          {error && <span className="text-sm text-red-400">{error}</span>}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-300">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-300">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows ?? 3}
        className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
    </label>
  );
}
