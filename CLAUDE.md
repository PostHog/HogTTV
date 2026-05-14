# HogTTV — Claude Code context

## What this repo is

A Chrome extension that renders custom Slack emojis in Google Meet chat. It's also the **demo repo for hoggit** — three bugs have been intentionally introduced to showcase `hoggit show`, `hoggit blame`, and `hoggit bisect`. Do not fix them unless asked.

## Hoggit

Hoggit wraps git with agent intent capture. Always use it for commits in this repo.

**Binary:** `./hoggit-aarch64-apple-darwin/hoggit`

### Workflow for every commit

1. Write the intent to a temp file first
2. Capture it: `./hoggit-aarch64-apple-darwin/hoggit intent capture -f /tmp/intent.txt -m claude-sonnet-4-6`
3. Stage files
4. Commit: `./hoggit-aarch64-apple-darwin/hoggit commit -m "human-readable message"`

If hoggit reports "no pending intents to bind" after the commit, bind directly:
```
./hoggit-aarch64-apple-darwin/hoggit intent capture -f /tmp/intent.txt -m claude-sonnet-4-6 --commit HEAD
```

### What goes in an intent

The reasoning that's invisible from the diff — thresholds tested, tradeoffs considered, false assumptions made, constraints from the environment. Not a summary of what changed (the diff covers that). Aim for 3–8 sentences.

### Key commands

```sh
hoggit show <sha>              # diff + commit message + intent
hoggit blame -L <n>,<m> <file> # git blame + per-commit intent rail
hoggit bisect start "<desc>" --good <sha> --bad HEAD
hoggit bisect run node test/emoji.js
hoggit bisect explain
```

## Tests

```sh
npm install        # first time only — installs jsdom
node test/emoji.js # exit 0 = pass, non-zero = fail
```

Compatible with `git bisect run node test/emoji.js` directly.

## Intentional demo bugs

| Commit | Change | Demo |
|--------|--------|------|
| `f271118` | `slice(0, 300)` → `slice(0, 150)` in picker grid | `hoggit show` / `hoggit blame` — magic number whose reason is invisible from the diff |
| `bbbda74` | `attributes: true` added to MutationObserver | `hoggit bisect` — one word, looks reasonable, causes Meet to lag |
| `74d39dd` | `fragments.length === 0` → `fragments.length < 2` | `hoggit bisect` — lone emoji and emoji-leading messages silently stop rendering |

## Overlap detection

Hoggit's server watches for teammates working on the same files and surfaces conflicts via the `UserPromptSubmit` hook. When the hook fires an overlap warning at the top of a turn, surface it to the user before proceeding.
