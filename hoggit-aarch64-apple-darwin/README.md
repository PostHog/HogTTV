# Hoggit: Version control for agentic coding

Embed context and intent in your commits.

---

This repo hosts `hoggit`, a CLI that wraps `git` with extra context. For now it's just a shell.

## The problem

git was built for humans. Commits are essentially units of change based on *outcomes* (what changed), and commit messages are rarely useful. Everything else involved in your coding process — agent prompts, conversations, intent — gets thrown away.

This was fine when humans were the ones primarily writing code, since we all have some rough memory of what each branch and commit was for. But now when agents are changing code in huge commit chunks, three weeks later nobody will be able to answer "why did we implement it this way again?"

hoggit conceptualizes a new part of commits called *intents*. These are attached to commits and include all of the context that's useful for agents to understand, reuse, debug, and fix past work.

## Terminology

- **Commit** — for human consumption. The outcome. Unchanged from git.
- **Intent** — for agent consumption. The reason. Prompt, plan, constraints, conversation context.
- **Publish** — the act of turning a stream of agentic micro-commits into a clean, reviewable history.

We are **not** reinventing version control. Git's content-addressed object store is already most of what we need — intents are just blobs that hang off commits via refs. We're adding the agent-shaped affordances on top.

## What an intent looks like

A textual blob: a header block of `key: value` pairs, then one or more body sections, separated by `----------`. Lenient parser, free-form sections.

```text
----------
model: claude-opus-4-7
captured: 2026-05-13 15:37:01
session: 7a3b9c2f
ticket: PH-4821
prompt: Rate limiting fires for everyone after the LB change. Investigate.
----------
# Plan
The new NLB preserves client IP at L4, but Contour terminates TLS and forwards.
The rate limiter reads the socket peer address, which is now Envoy's pod IP —
so every request looks like it came from the same source. Read X-Forwarded-For
(set by Envoy with num-trusted-hops=1) and fall back to the socket in local dev.
----------
# Constraints
- Don't trust XFF blindly: only honor it when the request came through the
  trusted ingress.
- Local dev has no ingress, so socket peer is fine when XFF is absent.
- Keep the existing API; only the IP-extraction helper changes.
----------
# Decisions
Considered the RFC 7239 `Forwarded` header instead. Skipped: Envoy emits XFF,
not Forwarded, and we control the ingress. Revisit if the proxy changes.
```

Three years later, `hoggit blame` on the rate-limiter line surfaces all three rails: the diff, the commit message ("Fix rate limiter behind NLB"), and this intent — so the next person on support sees *why* the socket address was wrong, not just *that* it changed.

## Demos

The hackathon goal is two working demos:

1. **Local.** `hoggit` CLI + an in-agent integration on a real repo.
2. **PostHog Code.** The same thing, wired into PostHog Code so agents working in the product get intent capture for free.

The two demos can stand alone; we'll connect them if time allows.

## What we're building

| Area | Owner |
|---|---|
| CLI scaffold | Phil |
| Post-merge / semantic conflict resolution | Phil |
| Server component (agent-to-agent coordination) | Tue |
| History simplification (`hoggit publish`) | Eli |
| `hoggit show`, `/hoggit-explain` | Jina |
| Demo, README | Jina |

## Example use cases

### Post-merge conflict resolution

Traditional merge tools are about textual conflicts that require human review. If we have intent attached, we can have agents auto-resolve them based on the intent. When we can't auto-resolve, we'll surface the intent gap, not just the textual diff.

### Pre-merge FYIs between agent sessions

If multiple developers or agents are simultaneously working on things they should know about — either by code surface area or by overlapping intents — the system notifies both via lightweight FYIs *before* either commits. Agent-to-agent comms are shaped as blobs (learning from an earlier hackathon project by Ryan).

### `hoggit blame` for understanding support incidents

Standard `git blame` shows you the line and the commit. `hoggit blame` shows three rails:

1. The code change
2. The **human's** version of what happened (commit message)
3. The **agent's** version of what happened (intent)

Useful if you're on support and facing a bug from a 2023 change where the original writer is unavailable. Even if you can find the simple fix yourself or with Claude, you'll likely need to understand the original reasoning before fixing it — not just *what* changed, but *why*.

### `hoggit publish`

The interactive-rebase replacement. Take a messy chain of agentic micro-commits and turn it into a publishable sequence of logical units. Hand-holding, conversational, not vim.

### Intent replay and multi-model review

Re-run the stored intents on a branch with a different model and diff the result — a review signal that surfaces "what would Claude 5 have done here." Generalizes to multi-model review: generate the diff with N models from the same intent and compare. Surfaces disagreement instead of laundering it.

### Agent-friendly bisect

`git bisect` is powerful and nobody remembers the flags. Wrap it so an agent can drive it from a behavior description: "here's the broken behavior, find the commit."

### Laws / policy checks (stretch)

Describe invariants ("every commit must add or update at least one test") and check agent actions against them. LTL-style, applied as a judge model.

## Architecture

```
┌───────────────────┐     ┌─────────────────┐
│   in-agent UI     │────▶│   hoggit CLI    │
│  (PostHog Code,   │     │   (this repo)   │
│   Claude Code,    │     └────────┬────────┘
│   …)              │              │
└───────────────────┘              ▼
                            ┌──────────────┐
                            │     git      │  ← unchanged
                            │  .git store  │
                            └──────┬───────┘
                                   │
                            ┌──────▼───────┐
                            │  intent refs │  ← new: blobs +
                            │  (refs/      │     refs hanging
                            │   hoggit/…)  │     off commits
                            └──────────────┘
                                   │
                            ┌──────▼───────┐
                            │ central hub  │  ← agent-to-agent
                            │  (server)    │     coordination
                            └──────────────┘
```

Intents are stored as git blobs, referenced by side-refs (à la `refs/notes/*`). Composable: a multi-turn agent session is N turn-blobs plus a session-object pointing to them, so identical turns are stored once.

Sync between machines: `hoggit init` configures `refs/hoggit/*` to ride along with `git fetch` (added fetch refspec) and `git push` (pre-push hook), so intents travel with branches without an extra command.

## Setup

```sh
bin/setup
```

Builds the release binary and prints what to do next. Follows the [PostHog scripts-to-rule-them-all convention](https://posthog.com/handbook/engineering/conventions/scripts).

## Releases

Pre-built binaries are published to [GitHub Releases](https://github.com/PostHog/hackathon-agentgit/releases) via [cargo-dist](https://github.com/axodotdev/cargo-dist). Builds are produced for macOS (ARM + Intel) and Linux x86_64.

### Downloading a release

The repo is internal, so downloads require GitHub authentication (any PostHog org member with repo access).

```sh
# Download the latest release for your platform (requires `gh` CLI, already authenticated)
gh release download --repo PostHog/hackathon-agentgit --pattern 'hoggit-aarch64-apple-darwin.tar.xz'
tar xf hoggit-aarch64-apple-darwin.tar.xz
mv hoggit ~/.cargo/bin/   # or anywhere on your PATH
```

Or use the generated shell installer:

```sh
curl --proto '=https' --tlsv1.2 -LsSf \
  -H "Authorization: token $(gh auth token)" \
  https://github.com/PostHog/hackathon-agentgit/releases/latest/download/hoggit-installer.sh | sh
```

### Cutting a release

Releases are triggered by pushing a version tag. The CI workflow builds binaries for all platforms and uploads them to a GitHub Release automatically.

1. Bump the version in `Cargo.toml`.
2. Commit the version bump.
3. Tag and push:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The [release workflow](.github/workflows/release.yml) handles the rest — plan, build, upload, and create the GitHub Release.

## Using hoggit in your repo

After `bin/setup`, point hoggit at any git repo to sync intents on push and fetch:

```sh
hoggit init                # set up the current repo
hoggit init /path/to/repo  # set up another repo (created with `git init` if missing, with a prompt)
hoggit init --yes ../new   # same, skip the prompt
```

`hoggit init` is idempotent — re-running is a no-op. It does two things:

- Adds `+refs/hoggit/*:refs/remotes/origin/hoggit/*` to `remote.origin.fetch`, so `git fetch` pulls intents into the remote-tracking namespace instead of clobbering your local `refs/hoggit/*`.
- Installs a `pre-push` hook that pushes `refs/hoggit/*` alongside any `git push`. The hook never fails the user's push; if intent sync errors, you get a warning on stderr and the push proceeds.

If a non-hoggit `pre-push` hook is already in place, init leaves it alone and prints the one-line snippet to merge in. To opt out later, remove the hook (`rm .git/hooks/pre-push`) and drop the fetch refspec with `git config --edit`.

### Overlap detection (a.k.a. the central hub from the diagram)

`hoggit init` also wires the repo to a small server that notices when two developers (or their agents) are working on the same code. The flow:

1. Every commit (or rewrite) fires `hoggit __sync`, which POSTs the current unpushed branch state — commits, diffs, and any intents attached to them — to the server.
2. The server, on each sync, compares your snapshot against everyone else's in the same project. If it sees file-level overlap, it asks Claude (Haiku 4.5) whether the two branches are about to conflict, or whether they're separately advancing on the same feature and would benefit from coordinating.
3. Findings are pushed back to a per-machine `hoggit __daemon` (installed as a macOS LaunchAgent by `init`). The daemon writes them to `<repo>/.hoggit/findings.json` and fires a system notification.
4. While Claude Code is active in the repo, the `UserPromptSubmit` hook handler fetches the latest findings and prints them to stdout, so they land in Claude's context for the next turn ("heads up: alice is also editing src/auth.ts").

Identity is deterministic — the project id is a v5 UUID of the normalized origin URL, so two clones of the same upstream see each other automatically. The actor key is `<git user.email>#<machine UUID>`, so the same user on two laptops appears as two distinct actors.

Run the server (Node/TS, Fastify) yourself:

```sh
hoggit server        # one-shot
hoggit server --dev  # watch + reload
```

By default it listens on `http://127.0.0.1:8787`. Override with `HOGGIT_SERVER` (the daemon and the CLI both read this env var). The server needs an Anthropic API key in `.env` at the repo root (`ANTHROPIC_API_KEY=sk-ant-...`).

### Teardown

`hoggit init` writes/touches a few places. To fully undo on macOS:

```sh
launchctl unload ~/Library/LaunchAgents/com.hoggit.daemon.plist
rm ~/Library/LaunchAgents/com.hoggit.daemon.plist
rm -rf ~/.hoggit                       # machine id + global repo list + daemon log
rm -rf <repo>/.hoggit                  # per-repo project id + findings + hook seen state
rm <repo>/.git/hooks/{post-commit,post-rewrite,pre-push}   # only if they're ours
git -C <repo> config --unset-all remote.origin.fetch '\+refs/hoggit/\*:refs/remotes/origin/hoggit/\*'
```

### Reading intents

`hoggit intent` accepts anything `git rev-parse` understands — a SHA, a ref, or a range:

```sh
hoggit intent                # intents for HEAD
hoggit intent main           # intents for the tip of main
hoggit intent <sha>          # intents for one commit
hoggit intent HEAD~3..HEAD   # intents across a range
```

Commits with no intent are reported as such, so you can pipe a wide range and see the gaps.

## Run

During development, invoke the CLI via cargo:

```sh
cargo run -- --help
cargo run -- hello
cargo run -- intent             # intents for HEAD
cargo run -- intent <sha>       # intents for a specific commit
cargo run -- intent <a>..<b>    # intents across a range
cargo run -- server             # run the overlap-detection server in the foreground
```

After `bin/setup` the release binary sits at `target/release/hoggit` — symlink, alias, or PATH-add it as you prefer.

## Implemented commands

| Command | Status | Description |
|---|---|---|
| `hoggit init [path]` | ✅ Working | Configure a repo so intents sync with `git push`/`git fetch`. Idempotent. |
| `hoggit commit [-m <msg>]` | 🚧 Stub | Wraps `git commit` and will bind the active intent buffer to the new commit SHA. |
| `hoggit intent capture` | ✅ Working | Write a new intent from stdin or a file. Attach to a commit with `--commit <ref>`, or leave it in the pending bucket. |
| `hoggit intent import-files` | 🚧 Stub | One-shot migration of filesystem-layout intent fixtures into the git-native store. |
| `hoggit show <sha>` | ✅ Working | Runs `git show <sha>` then appends any stored intents for that commit. |
| `hoggit server` | ✅ Working | Run the bundled overlap-detection server (Node/TS). Runs `pnpm install` on first launch if needed. |
| `hoggit resolve` | ✅ Working | Resolve merge/rebase/cherry-pick/revert conflicts using commit intents. |
| `hoggit hook <event>` | ✅ Working | Dispatcher for Claude Code hook events — streams payloads to `.hoggit/hooks.log`. Hidden from `--help`. |

### `hoggit intent capture` flags

```sh
hoggit intent capture                        # read body from stdin
hoggit intent capture -f intent.txt          # read from file
hoggit intent capture --model claude-opus-4-7  # tag with model name
hoggit intent capture --commit HEAD          # bind directly to HEAD
hoggit intent capture -H ticket=PH-1234      # add extra header fields (repeatable)
```

### `/hoggit-explain` (Claude Code skill)

A companion Claude Code skill that explains any commit in context: diff, commit message, and stored intent combined. Run it as:

```
/hoggit-explain <commit>
```

The primary use case is **agent-to-human reporting**: an agent investigating a bug or reviewing history can call `/hoggit-explain` and surface a plain-English summary back to you, rather than dumping raw diffs and intent files. You can also run it yourself whenever you want to understand a past commit without having to read the code change and intent side by side.

Produces a structured explanation (What changed / Why it was done / How it fits / Agent context) without fabricating missing intent.

## Adding a command

Each subcommand lives in its own file under `src/commands/`. To add a new one (say, `status`):

1. Create `src/commands/status.rs` with a `pub struct StatusArgs` (deriving `clap::Args`) and a `pub fn run(args: &StatusArgs) -> anyhow::Result<()>`.
2. Add `pub mod status;` to `src/commands/mod.rs`.
3. Add a `Status(commands::status::StatusArgs)` variant to the `Commands` enum in `src/main.rs`, and a matching arm in `main` that calls `commands::status::run(args)`.

Use `src/commands/hello.rs` as the template.

## Claude Code hooks

`hoggit init` wires Claude Code's hook events to `hoggit hook <event>` via `.claude/settings.json`. Every event streams its JSON payload to `.hoggit/hooks.log`:

```sh
tail -f .hoggit/hooks.log
```

Events currently wired (see the [hooks reference](https://code.claude.com/docs/en/hooks)):

| Event | Why we care |
|---|---|
| `SessionStart` / `SessionEnd` | Bookend the session object that groups turn-level intents. |
| `UserPromptSubmit` | Captures the root human intent — the "why" rail for `hoggit blame`. Also surfaces overlap findings from the server so Claude sees them in context. |
| `Stop` | Flush per-turn reasoning/plan into the intent buffer. |
| `SubagentStop` | Subagents do real work; their reasoning is intent too. |
| `PreCompact` / `PostCompact` | Snapshot reasoning before context compaction drops it. |
| `TaskCreated` / `TaskCompleted` | Track subagent task lifecycle for multi-turn intent graphs. |
| `PreToolUse` (Bash) | Inspect `git commit …` before it runs (advisory for now). |
| `PostToolUse` (Bash) | Bind point: after `git commit` succeeds, attach the intent buffer to the new SHA. |

`hoggit hook` dispatches each event: most are logged for intent capture, while `UserPromptSubmit` additionally queries the server for overlap findings and prints any unseen ones to stdout. Approve the hooks on first Claude Code session in this repo.
