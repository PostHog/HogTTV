---
name: hoggit-explain
description: Explain the purpose and reasoning behind a commit — not just what changed, but why it was done and how it fits into the codebase. Use when the user runs /hoggit-explain <commit>.
argument-hint: <commit>
allowed-tools: [Bash, Read]
---

# hoggit-explain

Explain the purpose and reasoning behind a commit — not just what changed, but why it was done and how it fits into the codebase. Combines the code diff, commit message, and stored intent (when available).

## When to use

- Debugging a decision made weeks ago
- Understanding a large agentic commit before reviewing or reverting it
- Reconstructing context for `hoggit blame` output
- Answering "why did we implement it this way?"

## Arguments

- `<commit>` — commit hash, ref, or range (e.g. `HEAD`, `abc123`, `main..HEAD`). Required.

## Steps

### 0. Check for missing argument

If no argument was provided, stop immediately and tell the user:

> Please provide a commit reference or range. Usage: `/hoggit-explain <commit>` (e.g. `abc123`, `HEAD~1`, `main..HEAD`).

Do not proceed further.

### 1. Validate the commit reference

**Single ref** (`HEAD`, `abc123`, `main`):

```
git rev-parse --verify <commit>
```

If this fails, stop and report: "`<commit>` is not a valid commit reference."

**Range** (`A..B` or `A...B`): validate both sides and check the range is non-empty:

```
git log <range> --oneline
```

If the command fails, stop and report: "`<range>` is not a valid range — check that both sides exist."

If it succeeds but returns no output, check whether the range is simply reversed:

```
git log <B>..<A> --oneline
```

If that returns commits, stop and report: "`<range>` is empty — did you mean `<B>..<A>`?" Otherwise stop and report: "`<range>` contains no commits."

### 2. Collect commit metadata

**Single commit:**

```
git show --stat <commit>
```

**Range:**

```
git log --stat <range>
```

This gives the commit message(s), author(s), date(s), and a file-level summary of what changed.

### 3. Read the diff

**Single commit:**

```
git show <commit>
```

**Range:**

```
git log -p <range>
```

For large commits or ranges, summarize by file and function rather than line-by-line. Focus on the shape of the change, not every hunk.

### 4. Read the intent (if available)

Intents are stored as git refs (`refs/hoggit/base/<sha>`) and surfaced via the CLI:

```
hoggit intent show <commit>
```

A commit may have multiple intents — the command prints each one in order. If the output is `no intents found for <commit>`, no intent was stored. **Do not fabricate one.** Note its absence and proceed with code inference only.

**Parsing the intent format**

The CLI prints each intent under a `commit <sha>` / `  intent <slot>` header with the body indented four spaces. Strip the leading whitespace, then read the `----------`-delimited sections. The first section is always metadata:

```
----------
model: <model-id>
captured: <timestamp>
----------
```

Extract `model` and `captured` for provenance — display them in **Agent context** as "captured at `<timestamp>` by `<model>`". Do not treat this metadata as intent reasoning.

Everything after the first metadata block is the intent body. The body may have multiple `----------`-separated sections, but their names and structure are not prescribed — read them as-is. Use the full body to inform **Why it was done** and **Agent context**.

### 5. Synthesize the explanation

Produce a structured explanation with these sections:

**What changed** — plain-English summary of the diff: which files, functions, and behaviors were affected.

**Why it was done** — drawn from the commit message and intent. If intent is missing, rely on the commit message and what the code itself implies about motivation.

**How it fits** — how this change relates to surrounding code, referenced issues or PRs, or adjacent commits in the branch.

**Agent context** *(only if intent is present)* — the original prompt or goal that drove the change, any constraints the agent was given, and what alternatives were considered or ruled out. Include "captured at `<timestamp>` by `<model>`" from the intent metadata.

## Handling missing intents

When no intent is found:

- Say explicitly: "No intent stored for this commit."
- Continue the explanation using git history and code context.
- Note what would be clearer if intent were present — this helps identify gaps worth capturing going forward.

## Output style

- Lead with *why*, not *what* — the diff already shows the what.
- Use plain prose, not bullet dumps.
- Keep it under ~200 words unless the commit is genuinely complex.
- For commit ranges, group by logical unit rather than by individual commit.
- For merge commits, explain the purpose of the merge itself, not each side independently.
