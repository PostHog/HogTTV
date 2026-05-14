---
name: hoggit-pull
description: Pull from a remote with intent-aware conflict resolution. Runs `git pull` (merge or rebase mode), and on conflict delegates to `hoggit resolve` for lockfile autoresolution, structural 3-way merge, and intent-driven duplicate detection. Use when the user runs /hoggit-pull [remote] [branch].
argument-hint: [remote] [branch] [git-pull-flags…]
allowed-tools: [Bash, Read, Edit]
---

# hoggit-pull

Pull from a remote with intent-aware conflict resolution. The skill orchestrates `git pull` plus `hoggit resolve`. Works the same for both merge-mode and rebase-mode pulls — `hoggit resolve` detects whichever git op is in flight and handles it.

## When to use

- Pulling the latest upstream changes before continuing work
- Recovering a stalled pull that left conflicts in the tree (run `/hoggit-pull` with no args to resume)
- Any time you'd run `git pull` and expect conflicts you don't want to slog through by hand

## Arguments

All arguments are optional. They are forwarded to `git pull`:

- `[remote]` — remote name (e.g. `origin`). Defaults to the upstream of the current branch.
- `[branch]` — branch on the remote. Defaults to the upstream branch.
- Flags such as `--rebase`, `--ff-only`, `--no-rebase`, `--autostash` are forwarded as-is.

If no arguments are given AND a pull is already in progress (merge or rebase), the skill resumes from the conflict state.

## Steps

### 1. Detect existing pull state

Before doing anything, check whether a merge or rebase from a prior pull is already in progress:

```
GIT_DIR="$(git rev-parse --git-dir)"
test -f "$GIT_DIR/MERGE_HEAD"     && echo "merge in progress"
test -d "$GIT_DIR/rebase-merge"   && echo "rebase in progress"
test -d "$GIT_DIR/rebase-apply"   && echo "rebase in progress"
```

If either is in progress, **skip Step 2** and jump straight to Step 4. The user is asking us to finish a stalled pull.

If no op is in progress, proceed to Step 2.

### 2. Validate state

Check the working tree is clean enough to pull:

```
git status --porcelain
```

If there are unstaged changes and `--autostash` was not passed, stop and report what's dirty. Don't auto-stash — the user may have in-progress work.

Verify the current branch has an upstream (unless explicit remote/branch were given):

```
git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
```

If this fails and no explicit remote was passed, stop and report: "Current branch has no upstream. Use `/hoggit-pull <remote> <branch>` to set one for this pull."

### 3. Run the pull

```
git pull [forwarded-args…]
```

Capture the exit code.

- **Exit 0**: Pull succeeded with no conflicts. Report the new `HEAD` (`git log -1 --oneline`) and stop.
- **Non-zero**: Inspect `git status` and the `.git/` sentinel files to determine if this is a conflict or some other failure (e.g. unrelated histories, network error, hook rejection). If `MERGE_HEAD` exists or a `rebase-merge`/`rebase-apply` directory exists, it's a conflict — proceed to Step 4. Otherwise report the failure verbatim and stop.

### 4. Run hoggit resolve

```
hoggit resolve
```

Capture stdout (JSONL `ResolutionBrief` lines, if any) and the exit code.

- **Exit 0**: Resolve handled everything — lockfiles, structural merges, duplicates — and ran the appropriate `git X --continue` (merge commit, or rebase advance). Check whether the rebase is fully done:

  ```
  test -d "$(git rev-parse --git-dir)/rebase-merge" -o -d "$(git rev-parse --git-dir)/rebase-apply" && echo "rebase still in progress"
  ```

  If the rebase is still in progress (more commits to replay), loop back to Step 4 to resolve the next conflict. Otherwise report the new `HEAD` and stop.

- **Exit 2**: Some hunks need agent judgment. Each stdout line is a `ResolutionBrief` JSON object. Proceed to Step 5.

- **Other non-zero**: Resolve itself failed. Report stderr verbatim and stop.

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

1. **Read** the conflicted region of `file` — use the `hunk` line range as a starting point.
2. **Decide** based on `classification`:
   - `orthogonal` — combine both sides; they touch unrelated things.
   - `compatible` — pick the clearer expression of the shared intent (or merge them).
   - `exclusive` — use the intents (`ours.intents`, `theirs.intents`) to pick whichever side's stated goal still applies. If both still apply, ask the user.
   - `unknown` — read the code and intents directly.
3. **Apply** the resolution with `Edit`. Remove all `<<<<<<<`, `=======`, `>>>>>>>` markers.
4. **Stage**: `git add <file>`.

Treat `hoggit_proposal`, when present, as a strong hint to verify — not a blind directive.

If you cannot confidently resolve a hunk, stop and surface the unresolved briefs to the user.

### 6. Continue the pull

Once all conflicted files are staged:

```
hoggit resolve --continue
```

For merge-mode pulls this finishes with `git commit --no-edit`. For rebase-mode pulls this advances to the next commit — which may itself produce conflicts. **Loop back to Step 4** if the rebase is still in progress.

When the pull is fully complete, report:

- The new `HEAD` (`git log -1 --oneline`)
- A one-line summary of what was resolved (auto-resolved files vs. agent-resolved hunks; for rebase, the number of commits replayed)

## Aborting

If at any point the user asks to abort, run:

```
hoggit resolve --abort
```

This runs `git merge --abort` or `git rebase --abort` depending on the active op.

## Output style

- Lead with what happened. "Pulled `origin/main` (rebased 3 commits, 1 lockfile regenerated, 0 agent-resolved hunks)" is better than narrating each step.
- For rebase-mode pulls, mention the number of commits replayed.
- Only show resolution briefs when you couldn't resolve them yourself.
