# gh-monitor

Monitor GitHub repos and dispatch work to OpenCode agents automatically. Powered by [opencode-pilot](https://github.com/athal7/opencode-pilot).

When an issue is assigned to you or a PR needs attention, opencode-pilot polls GitHub, creates an OpenCode session for the repo, and sends the task as a prompt. The agent handles it — pushes code, replies on the PR, or answers questions — with full context persistence per item.

## Setup

```bash
bin/setup
```

This installs `opencode-pilot` (if needed) and symlinks the config + templates into `~/.config/opencode/pilot/`.

## Usage

```bash
opencode-pilot start
```

The daemon runs in the foreground. It polls GitHub on an interval and spawns OpenCode sessions when work is found.

### What it watches

| Source | Trigger | Prompt template |
|--------|---------|-----------------|
| `github/my-issues` | Issues assigned to me on configured repos | `default` |
| `github/my-prs-attention` | My PRs with conflicts or human review feedback | `review-feedback` |

### Monitored repos

Currently configured for:
- `g2crowd/buyer_intent_api`

Edit `pilot/config.yaml` to add more repos or sources.

## Project structure

```
gh-monitor/
├── bin/
│   ├── gh-monitor     # Standalone bash poller (no opencode-pilot dependency)
│   └── setup          # Installs opencode-pilot and symlinks config
├── pilot/
│   ├── config.yaml    # opencode-pilot configuration (canonical source)
│   └── templates/     # Prompt templates
│       ├── default.md
│       └── review-feedback.md
└── README.md
```

The `pilot/` directory is the canonical source for all opencode-pilot config. `bin/setup` symlinks it into `~/.config/opencode/pilot/` so you can version-control your config here and have it take effect globally.

## Standalone poller

`bin/gh-monitor` is a standalone bash script that polls GitHub and emits JSONL events. It predates the opencode-pilot integration and is useful for:
- Lightweight monitoring without OpenCode (just writes events to a file)
- Piping events into other tools
- Environments where opencode-pilot isn't installed

```bash
bin/gh-monitor g2crowd/buyer_intent_api
```

See `bin/gh-monitor --help` for options.

## Customization

### Adding repos

Edit `pilot/config.yaml`:

```yaml
sources:
  - preset: github/my-issues
    repos:
      - g2crowd/buyer_intent_api
      - g2crowd/ue                    # add more repos here
```

Run `bin/setup` again to re-symlink, then `opencode-pilot config` to validate.

### Adding prompt templates

Add markdown files to `pilot/templates/`. Use `{title}`, `{body}`, `{number}`, `{html_url}` as placeholders. Reference the template name (filename without `.md`) in `config.yaml` via the `prompt:` field.

### Worktree isolation

Run each issue in a fresh git worktree:

```yaml
sources:
  - preset: github/my-issues
    worktree: "new"
    worktree_name: "issue-{number}"
    prompt: worktree
```

## CLI reference

```bash
opencode-pilot start              # Start polling (foreground)
opencode-pilot stop               # Stop the daemon
opencode-pilot status             # Show version and status
opencode-pilot config             # Validate config
opencode-pilot test-source NAME   # Dry-run a source
opencode-pilot clear --all        # Reset processed-item state
opencode-pilot logs --follow      # Tail the log
```
