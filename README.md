# gh-monitor

Poll GitHub repos for activity and dispatch work to OpenCode agent sessions. Each PR and issue gets its own persistent session with full context accumulation.

## Setup

```bash
npm install
```

## Configuration

Create `gh-monitor.json` in the project root (or `~/.config/gh-monitor/config.json`):

```json
{
  "repos": ["g2crowd/ue", "g2crowd/buyer_intent_api"],
  "repoDirectories": {
    "g2crowd/ue": "~/code/ue",
    "g2crowd/buyer_intent_api": "~/code/buyer_intent_api"
  },
  "intervalMs": 60000
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `repos` | yes | GitHub repos to watch (`owner/name`) |
| `repoDirectories` | yes | Map of repo → local checkout path |
| `owner` | no | GitHub login to watch (default: `gh` authenticated user) |
| `intervalMs` | no | Poll interval in ms (default: 60000) |

## Usage

```bash
npm run dev       # Run with tsx (no build step)
npm run build     # Compile TypeScript
npm start         # Run compiled JS
```

## How it works

1. **Poller** (`src/poller.ts`) — calls `gh` CLI every `intervalMs` to check for new PR comments, review comments, and issues from `owner` on configured repos
2. **Dispatcher** (`src/dispatcher.ts`) — uses `@opencode-ai/sdk` to create/resume OpenCode sessions. One session per PR or issue, so context accumulates across multiple comments
3. **Entry point** (`src/index.ts`) — loads config, wires poller → dispatcher, handles shutdown

## What it watches

| Event | Source |
|-------|--------|
| `pr_comment` | Your comments on the conversation tab of your open PRs |
| `pr_review_comment` | Your inline code review comments on your open PRs |
| `new_issue` | Issues you create on watched repos |

## Session management

Sessions are keyed by `repo#pr-N` or `repo#issue-N`. When a new event arrives for a PR/issue that already has a session, the dispatcher sends the new prompt to the existing session — the agent has full history of everything that's happened on that PR/issue.

Session state persists in `~/.local/share/gh-monitor/sessions.json`.

## Architecture

```
gh-monitor.json (config)
       │
       ▼
   index.ts (wires everything)
       │
       ├── poller.ts ──▶ gh CLI ──▶ GitHub API
       │       │
       │       ▼ (GitHubEvent)
       │
       └── dispatcher.ts ──▶ @opencode-ai/sdk ──▶ OpenCode sessions
```

## Adding pollers

The poller is a simple class. To add Jira, Linear, or any other source:

1. Create a new poller class that emits events with the same `GitHubEvent` shape (or extend it)
2. Wire it into `index.ts` alongside the GitHub poller
3. The dispatcher doesn't care where events come from — it just needs `repo`, `body`, and a way to key the session

## Standalone bash poller

`bin/gh-monitor` is the original bash script — lightweight, no dependencies, emits JSONL. Useful for environments without Node.

```bash
bin/gh-monitor g2crowd/ue --interval 30
```
