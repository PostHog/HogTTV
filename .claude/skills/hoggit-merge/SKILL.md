---
name: hoggit-merge
description: Merge a branch with intent-aware conflict resolution. Runs `git merge`, and on conflict delegates to `hoggit resolve` for lockfile autoresolution, structural 3-way merge, and intent-driven duplicate detection. Surfaces only the hunks that genuinely need a human or agent decision. Use when the user runs /hoggit-merge <ref>.
argument-hint: <ref> [git-merge-flags…]
allowed-tools: [Bash, Read, Edit]
---

# hoggit-merge

Merge a branch with intent-aware conflict resolution. The skill orchestrates plain `git merge` plus `hoggit resolve` (which handles stacked-PR duplicate detection, lockfile regeneration, and mergiraf structural merging). Anything left over comes back as JSONL resolution briefs that this skill walks through one hunk at a time.

## When to use

- Merging a feature branch into main (or vice versa) where the other side has moved
- Anywhere you'd run `git merge` and expect conflicts you don't want to slog through by hand
- Following up on a merge that was started manually and stalled with conflicts (just run `/hoggit-merge` with no args — see Step 1)

## Arguments

- `<ref>` — branch, tag, or commit to merge into the current branch. Required *unless* a merge is already in progress (in which case run with no arguments to resume).
- Any additional arguments are forwarded to `git merge` (e.g. `--no-ff`, `--ff-only`, `--squash`, `-m "msg"`).

## Steps

### 1. Detect existing merge state

Before doing anything else, check whether a merge is already in progress:

```
test -f "$(git rev-parse --git-dir)/MERGE_HEAD" && echo "merge in progress"
```

If a merge is in progress, **skip Step 2** and jump straight to Step 4 (resolve). The user is asking us to finish a stalled merge.

If no merge is in progress and no `<ref>` was given, stop and tell the user:

> Please provide a branch or commit to merge. Usage: `/hoggit-merge <ref>` (e.g. `main`, `origin/feature-x`).

### 2. Validate the ref

```
git rev-parse --verify <ref>
```

If this fails, stop and report: "`<ref>` is not a valid commit reference."

Also verify the working tree is clean enough to merge:

```
git status --porcelain
```

If there are unstaged changes, stop and report what's dirty. Don't try to stash automatically — the user may have in-progress work.

### 3. Run the merge

```
git merge <ref> [forwarded-flags…]
```

Capture the exit code.

- **Exit 0**: Merge succeeded with no conflicts. Report the merge commit SHA (`git rev-parse HEAD`) and stop.
- **Non-zero**: Inspect `git status` to determine whether this was a conflict or some other failure (e.g. "refusing to merge unrelated histories", aborted by hook). If `MERGE_HEAD` exists, it's a conflict — proceed to Step 4. Otherwise report the failure verbatim and stop.

### 4. Run hoggit resolve

```
hoggit resolve
```

Capture stdout (which may contain JSONL `ResolutionBrief` lines) and the exit code.

- **Exit 0**: Resolve handled everything — lockfiles regenerated, structural merges applied, duplicates dropped — and ran `git commit --no-edit` to finish the merge. Report the resulting commit SHA and stop.
- **Exit 2**: Some hunks need agent judgment. Each stdout line is a `ResolutionBrief` JSON object. Proceed to Step 5.
- **Other non-zero**: Something went wrong inside resolve itself. Report the stderr verbatim and stop. Do not attempt to recover.

### 5. Resolve remaining hunks from the briefs

Each `ResolutionBrief` has this shape:

```json
{
  "file": "src/foo.rs",
  "hunk": {"start_line": 42, "end_line": 67},
  "ours": {"sha": "...", "code": "…HEAD side…", "intents": [...]},
  "theirs": {"sha": "...", "code": "…incoming side…", "intents": [...]},
  "base": {"sha": "...", "code": "…common ancestor…"},
  "classification": "orthogonal | compatible | exclusive | unknown",
  "hoggit_proposal": "…optional suggested resolution…",
  "notes": "…optional context…"
}
```

For each brief:

1. **Read** the conflicted region of `file` — use the `hunk` line range as a starting point. The conflict markers may extend slightly beyond it.
2. **Decide** based on `classification`:
   - `orthogonal` — combine both sides; they touch unrelated things.
   - `compatible` — pick the clearer expression of the shared intent (or merge them).
   - `exclusive` — use the intents (`ours.intents`, `theirs.intents`) to pick whichever side's stated goal still applies. If both still apply, ask the user.
   - `unknown` — read the code and intents directly.
3. **Apply** the resolution using `Edit`. Remove all `<<<<<<<`, `=======`, `>>>>>>>` markers.
4. **Stage** the file: `git add <file>`.

If `hoggit_proposal` is present, treat it as a strong hint — but verify it against the surrounding code before accepting. Don't apply it blindly.

If you cannot confidently resolve a hunk (e.g. `exclusive` with both intents still relevant), stop and surface the conflict to the user with the briefs you couldn't resolve.

### 6. Continue the merge

Once all conflicted files are staged:

```
hoggit resolve --continue
```

This runs `git commit --no-edit` to finish the merge. Verify the merge commit exists:

```
git rev-parse HEAD
git status
```

Report the merge commit SHA and a one-line summary of what was resolved (auto-resolved files vs. agent-resolved hunks).

## Aborting

If at any point the user asks to abort, run:

```
hoggit resolve --abort
```

This runs `git merge --abort` and returns to the pre-merge state.

## Output style

- Lead with what happened, not what you did. "Merged `origin/main` (12 files, 3 lockfiles regenerated, 1 hunk resolved by intent classification)" is better than narrating each step.
- Only show resolution briefs to the user when you couldn't resolve them yourself.
- For straightforward merges (exit 0 from `git merge` or `hoggit resolve`), keep the report to one or two sentences.
