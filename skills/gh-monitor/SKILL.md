---
name: gh-monitor
description: Use when receiving dispatches from gh-monitor (automated GitHub/Jira watcher). Triggers on "[jira]", "[github]", "gh-monitor", "dispatch", or when the system prompt mentions "gh-monitor". Governs all communication protocols for remote work — Jira reactions, GitHub comments, PR workflows, and post-deploy verification. ALWAYS load this skill when the user is communicating via Jira or GitHub rather than locally.
---

# gh-monitor — Remote Work Communication Protocol

The user is **not present locally**. They communicate through GitHub comments, Jira tickets, and PR reviews. All feedback must go through those channels — terminal output is invisible to them.

## 1. Immediate Acknowledgment (MANDATORY)

When you receive a dispatch, **acknowledge BEFORE doing any work**:

### GitHub Comments

```bash
gh api repos/{owner}/{repo}/issues/comments/{comment_id}/reactions -f content="eyes"
```

### Jira Tickets

```bash
gh-monitor-jira add_comment LABS-123 "👀 On it."
gh-monitor-jira transition LABS-123 3
```

Transition ID `3` = **Working**. Always move the ticket to Working when you start.

**Rule**: The user must see acknowledgment within your FIRST tool call. No research, no analysis, no planning first — react immediately, then work.

## 2. Jira CLI (`gh-monitor-jira`)

Do NOT use any Jira MCP tools. Use the `gh-monitor-jira` CLI for all Jira operations:

```bash
# Comment on a ticket
gh-monitor-jira add_comment LABS-123 "Your message here"

# Get issue details
gh-monitor-jira get_issue LABS-123
gh-monitor-jira get_issue LABS-123 summary status description

# Search with JQL
gh-monitor-jira search "project = LABS AND status = 'To Do'"

# Transition a ticket (see transition IDs below)
gh-monitor-jira transition LABS-123 3

# List available transitions
gh-monitor-jira get_transitions LABS-123

# Update issue fields
gh-monitor-jira edit_issue LABS-123 '{"summary":"Updated title"}'

# Create a new issue
gh-monitor-jira create_issue '{"project":{"key":"LABS"},"issuetype":{"name":"Task"},"summary":"New task","parent":{"key":"LABS-918"}}'
```

### Transition IDs (LABS project)

| Status | Transition ID | When |
|--------|---------------|------|
| To Do | `11` | Created but not started |
| In Progress | `21` | Acknowledged, planning |
| Working | `3` | Actively working |
| In Review | `2` | Done, waiting for user review |
| Done | `31` | **Never use** — user's responsibility |

### Lifecycle

1. Ticket arrives → `transition 3` (Working) + `add_comment` acknowledgment
2. Work in progress → push code, create PRs
3. Work complete → `transition 2` (In Review) + `add_comment` with results
4. User sends feedback → `transition 3` (Working) + address feedback
5. User approves → they move to Done

You can create subtasks with `create_issue` and leave them in To Do.

## 3. GitHub CLI (`gh`)

```bash
# React to a comment
gh api repos/{owner}/{repo}/issues/comments/{comment_id}/reactions -f content="eyes"

# Reply on a PR/issue
gh api repos/{owner}/{repo}/issues/{number}/comments -f body="Your message"

# Create a PR
gh pr create --repo {owner}/{repo} --title "type: description" --body "..."

# Check PR state before pushing
gh pr view {number} --repo {owner}/{repo} --json state --jq '.state'
```

## 4. Dispatch Message Format

gh-monitor sends messages with these prefixes:

```
[jira] epic_issue: jira:LABS-123       — New ticket. Read description, acknowledge, plan work.
[jira] issue_comment: jira:LABS-123    — User commented. Acknowledge, respond to feedback.
[github] pr_comment: g2crowd/ue#39049  — PR conversation comment. React with 👀, then work.
[github] pr_review_comment: ...        — Inline code comment. React with 👀, address feedback.
[github] new_issue: g2crowd/ue#123     — New issue. Acknowledge, start work.
```

## 5. Communication Rules

- **Be concise.** 1-3 sentences per comment. The user can jump into the OpenCode session for full context.
- **Always acknowledge first.** Emoji reaction or comment before doing anything else.
- **Update both channels.** If a Jira ticket leads to a GitHub PR, comment the PR link back on Jira.
- **Never work silently.** If you've been working for more than a few minutes, post a progress update.
- **Include the Jira ticket key** in PR bodies and commit messages: `[LABS-123]`

## 6. Status CLI (`gh-monitor-status`)

Check the health of all dispatched sessions:

```bash
gh-monitor-status         # Human-readable output
gh-monitor-status --json  # JSON output
```

## 7. Error Recovery

### Jira CLI Fails

If `gh-monitor-jira` errors, fall back to posting on the GitHub PR via `gh api`. Never silently fail to communicate.

### PR Already Merged

Check before pushing:

```bash
gh pr view {number} --repo {owner}/{repo} --json state --jq '.state'
```

If `MERGED`: create a new branch from `origin/main`, apply changes, create a new PR.
