# TODO

## Worktree isolation per session
- Dispatcher creates a worktree via OpenCode's `/experimental/worktree` API before sending the first prompt
- Session starts inside the isolated worktree
- System prompt tells the agent to load `git-worktrees` skill for further management
- Config option `"worktree": true` per-source (e.g. worktrees for Jira issues, not for PR comment quick fixes)
- Reuse existing worktrees by name match (like opencode-pilot does)
- Reference: opencode-pilot's `service/worktree.js`, our `git-worktrees` skill
