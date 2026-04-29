# arb

Poll GitHub repos and Jira boards for activity and dispatch work to AI agent sessions. Each PR, issue, or ticket gets its own persistent session with full context accumulation.

## Setup

```bash
npm install
```

## Configuration

Create `arb.json` in the project root (or `~/.config/arb/config.json`):

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
2. **Jira Poller** (`src/jira-poller.ts`) — polls Jira boards via REST API for new tickets and comments
3. **Dispatcher** (`src/dispatcher.ts`) — uses `@opencode-ai/sdk` to create/resume agent sessions. One session per PR, issue, or ticket, so context accumulates across multiple comments
4. **Entry point** (`src/index.ts`) — loads config, wires pollers → dispatcher, handles shutdown

## What it watches

| Event | Source |
|-------|--------|
| `pr_comment` | Your comments on the conversation tab of your open PRs |
| `pr_review_comment` | Your inline code review comments on your open PRs |
| `new_issue` | Issues you create on watched repos |
| `epic_issue` | New Jira tickets matching the configured JQL |
| `issue_comment` | Comments on tracked Jira tickets |

## Session management

Sessions are keyed by `repo#pr-N`, `repo#issue-N`, or `jira:PROJ-N`. When a new event arrives for a PR/issue/ticket that already has a session, the dispatcher sends the new prompt to the existing session — the agent has full history of everything that's happened.

Session state persists in `~/.local/share/arb/sessions.json`.

## CLI tools

### `arb-jira`

Standalone CLI for Jira operations (comments, transitions, issue creation):

```bash
arb-jira add_comment PROJ-123 "Looking into this."
arb-jira transition PROJ-123 3
arb-jira get_issue PROJ-123
```

### `arb-status`

Check the health of all dispatched sessions:

```bash
arb-status         # Human-readable output
arb-status --json  # JSON output
```

## Architecture

```
arb.json (config)
       │
       ▼
   index.ts (wires everything)
       │
       ├── poller.ts ──▶ gh CLI ──▶ GitHub API
       │       │
       │       ▼ (MonitorEvent)
       │
       ├── jira-poller.ts ──▶ Jira REST API
       │       │
       │       ▼ (MonitorEvent)
       │
       └── dispatcher.ts ──▶ @opencode-ai/sdk ──▶ agent sessions
```

## Adding pollers

The poller is a simple class. To add Linear, Slack, or any other source:

1. Create a new poller class that emits events with the `MonitorEvent` shape
2. Wire it into `index.ts` alongside the existing pollers
3. The dispatcher doesn't care where events come from — it just needs `source`, `body`, and a way to key the session

## Standalone bash poller

`bin/arb` is the original bash script — lightweight, no dependencies, emits JSONL. Useful for environments without Node.

```bash
bin/arb g2crowd/ue --interval 30
```
