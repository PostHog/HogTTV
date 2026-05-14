---
name: hoggit-blame
description: Explain why a line (or range) of code looks the way it does — combining git blame, commit messages, and stored intents into a single narrative. Use when the user runs /hoggit-blame <file>[:<line>[-<end>]] or asks "why is this line here?"
argument-hint: <file>[:<line>[-<end>]]
allowed-tools: [Bash, Read]
---

# hoggit-blame

Answer "why does this code look like this?" by walking the three rails of history: the diff (what changed), the commit message (the human's framing), and the stored intent (the agent's reasoning).

Where `/hoggit-explain` operates on a known commit, `/hoggit-blame` starts from a *line of code* you don't yet have a SHA for. Use it when you're debugging unfamiliar code and need the original reasoning before you touch it.

## When to use

- Debugging a bug in code you didn't write
- Considering a change to existing code and wanting to know what invariants it was built to preserve
- Tracing a behavior back to the decision that introduced it
- Answering "why doesn't this just do X instead?" — the intent often explains why X was ruled out

## Arguments

- `<file>` — required, repo-relative path.
- `<line>` or `<start>-<end>` — optional, appended after a colon (e.g. `src/auth.rs:42`, `src/auth.rs:42-78`). If omitted, the whole file is blamed.

## Steps

### 0. Validate input

If no file argument was provided, stop and tell the user:

> Please provide a file path. Usage: `/hoggit-blame <file>[:<line>[-<end>]]` (e.g. `src/auth.rs:42-78`).

Check the file exists with `test -f <file>`. If it doesn't, stop and report: "`<file>` does not exist in the working tree."

### 1. Parse the line range

If the argument contains `:`, split on the last colon. The right side is the line spec:

- `42` → `-L 42,42`
- `42-78` → `-L 42,78`
- anything else (commas, regex) → pass through as `-L <spec>` and let `git blame` handle it

If there's no colon, blame the whole file (no `-L` flag).

### 2. Run hoggit blame

```
hoggit blame [-L <start>,<end>] -- <file>
```

The output has two parts separated by `── hoggit intents ──`:

1. **Standard `git blame` lines** — one per source line, with SHA, author, date, line number, content.
2. **Per-commit intent rail** — each unique touched commit listed in first-appearance order, with its short SHA, commit subject, and either the stored intent body or `(no intent attached)`.

If `hoggit blame` fails (e.g. "no such path in HEAD"), stop and report the error verbatim.

### 3. Read each intent

The intent rail dumps the framed intent body inline. Parse it the same way `/hoggit-explain` does:

- The first `----------`-delimited block is metadata (`model`, `captured`, optional `ticket`/`session`/`prompt` headers).
- Everything after is free-form body sections, often titled like `# Plan`, `# Constraints`, `# Decisions`.

Don't fabricate intent. If a commit shows `(no intent attached)`, say so explicitly and fall back to the commit message + diff for that commit.

### 4. Synthesize the answer

Produce a tight narrative shaped for an agent about to touch this code. Structure:

**What's here** — one sentence on what the blamed lines actually do (read them from the blame output; don't re-read the file). If a range is small enough, quote a representative line or two.

**Origin** — for each unique commit touching the range (in the order the rail listed them, which is first-appearance order in the blamed lines):

- `<short-sha>` — `<commit subject>` (`<date>`, `<author>`)
- One sentence on what that commit changed for this region.
- If an intent is attached: the *why* in plain prose, drawing from the body sections. Lead with the goal/prompt, then any non-obvious constraints or rejected alternatives.
- If no intent: say "(no intent — commit message and diff only)" and move on.

**Constraints to preserve** *(only if intents surface any)* — bulleted list of invariants, "don't do X", or "X was rejected because Y" notes drawn directly from the intent bodies. This is the part that keeps the next agent from naively "fixing" code by removing the original reasoning.

**Gaps** *(only if any commit had no intent)* — one line: "N of M commits in this range have no captured intent." This is honest signal, not noise — it tells the agent how much of the explanation is firsthand vs. inferred.

## Output style

- Lead with **why**, not **what**. The diff already tells you what.
- Plain prose; bullets only for the constraint list.
- Keep the whole response under ~250 words unless the range spans many commits with rich intents.
- For ranges with only one origin commit, collapse "Origin" into a single paragraph.
- Don't quote intent bodies verbatim unless the user asked to see them — summarize.

## When intents are sparse

Blame against pre-hoggit history (or a team still adopting it) will mostly return `(no intent attached)`. That's expected. Do the synthesis anyway from commit messages + diffs, and surface the gap so the user can decide whether to capture an intent for the next change in this region.
