# gh-monitor

Monitor GitHub repos and dispatch work to OpenCode agents via [opencode-pilot](https://github.com/athal7/opencode-pilot).

When an issue is assigned to you or a PR needs attention, opencode-pilot polls GitHub, creates an OpenCode session for the repo, and sends the task as a prompt.

## Setup

```bash
npm install
npm run install-config
```

## Usage

```bash
npm start           # Start polling (foreground)
npm run status      # Show service status
npm run config      # Validate configuration
npm run logs        # Tail the log
npm run test-issues # Dry-run the issues source
npm run test-prs    # Dry-run the PR attention source
npm run clear       # Reset processed-item state
```

## What it watches

| Source | Trigger | Prompt |
|--------|---------|--------|
| `github/my-issues` | Issues assigned to me | `default` |
| `github/my-prs-attention` | My PRs with conflicts or review feedback | `review-feedback` |

Currently configured for `g2crowd/buyer_intent_api`. Edit `pilot/config.yaml` to add more.

## How it responds to your comments

`my-prs-attention` enriches PRs with comment data on each poll. When it detects new **actionable feedback** — a reviewer comment, an inline code comment, or a formal review — it spawns/re-enters an OpenCode session.

**What triggers a session:**
- Reviewer leaves a comment or requests changes on your PR
- You leave an **inline comment on the diff** (standalone, not a reply)
- You submit a formal PR review on your own PR

**What does NOT trigger:**
- Your own top-level comments in the conversation tab (filtered as author noise)
- Bot comments (dependabot, github-actions, linear)
- Approval-only reviews with no body text

**Workaround for self-commenting:** Create an issue and assign it to yourself — `github/my-issues` picks those up directly.

## Project structure

```
gh-monitor/
├── bin/gh-monitor          # Standalone bash poller (no opencode-pilot dependency)
├── pilot/
│   ├── config.yaml         # opencode-pilot configuration
│   └── templates/
│       ├── default.md      # Issue work prompt
│       └── review-feedback.md
├── package.json
└── README.md
```

## Configuration

Edit `pilot/config.yaml`, then `npm run install-config` to copy it into place.

### Adding repos

```yaml
sources:
  - preset: github/my-issues
    repos:
      - g2crowd/buyer_intent_api
      - g2crowd/ue
```

### Adding prompt templates

Add `.md` files to `pilot/templates/`. Use `{title}`, `{body}`, `{number}`, `{html_url}` as placeholders. Reference by filename (without `.md`) in the `prompt:` field.

### Worktree isolation

```yaml
sources:
  - preset: github/my-issues
    worktree: "new"
    worktree_name: "issue-{number}"
```
