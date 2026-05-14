---
name: hoggit-cherry-pick
description: Cherry-pick one or more commits with intent-aware conflict resolution. Runs `git cherry-pick`, and on conflict delegates to `hoggit resolve` for lockfile autoresolution, structural 3-way merge, and intent-driven duplicate detection. Use when the user runs /hoggit-cherry-pick <commit>…
argument-hint: <commit>… [git-cherry-pick-flags…]
allowed-tools: [Bash, Read, Edit]
---

# hoggit-cherry-pick

Cherry-pick one or more commits onto the current branch with intent-aware conflict resolution. The skill orchestrates `git cherry-pick` plus `hoggit resolve`. Multiple commits are processed sequentially — when one picks cleanly, git moves to the next; when one conflicts, the skill resolves and continues.

## When to use

- Backporting a fix from one branch to another
- Replaying a series of commits onto a different base
- Recovering a stalled cherry-pick that left conflicts (run `/hoggit-cherry-pick` with no args to resume)

## Arguments

- `<commit>…` — one or more commit references, or a range (`A..B`). Required *unless* a cherry-pick is already in progress (in which case run with no arguments to resume).
- Flags such as `--no-commit`, `-x`, `-m <parent>`, `--strategy=…` are forwarded to `git cherry-pick`.

## Steps

### 1. Detect existing cherry-pick state

Before doing anything, check whether a cherry-pick is already in progress:

```
test -f "$(git rev-parse --git-dir)/CHERRY_PICK_HEAD" && echo "cherry-pick in progress"
```

If a cherry-pick is in progress, **skip Step 2** and jump straight to Step 4. The user is asking us to finish a stalled cherry-pick.

If no cherry-pick is in progress and no `<commit>` was given, stop and tell the user:

> Please provide one or more commits to cherry-pick. Usage: `/hoggit-cherry-pick <commit>…` (e.g. `abc123`, `abc123 def456`, `main..feature`).

### 2. Validate the commits

For each ref provided:

```
git rev-parse --verify <commit>
```

For ranges, also confirm they're non-empty:

```
git log <range> --oneline
```

If any ref fails to resolve, stop and report which one.

Also verify the working tree is clean:

```
git status --porcelain
```

If there are unstaged changes, stop and report what's dirty.

### 3. Run the cherry-pick

```
git cherry-pick <commit>… [forwarded-flags…]
```

Capture the exit code.

- **Exit 0**: All commits picked cleanly. Report the new `HEAD` (`git log -<N> --oneline` where N is the number of commits picked) and stop.
- **Non-zero**: Inspect `git status` — if `CHERRY_PICK_HEAD` exists, it's a conflict on the current commit. Proceed to Step 4. Otherwise report the failure verbatim.

### 4. Run hoggit resolve

```
hoggit resolve
```

Capture stdout (JSONL `ResolutionBrief` lines, if any) and the exit code.

- **Exit 0**: Resolve handled the current commit's conflicts and ran `git cherry-pick --continue`. Check whether more commits remain:

  ```
  test -f "$(git rev-parse --git-dir)/CHERRY_PICK_HEAD" && echo "cherry-pick still in progress"
  ```

  If yes, **loop back to Step 4** — the next commit conflicted. Otherwise report the final `HEAD` and stop.

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

1. **Read** the conflicted region of `file`.
2. **Decide** based on `classification`:
   - `orthogonal` — combine both sides; they touch unrelated things.
   - `compatible` — pick the clearer expression of the shared intent (or merge them).
   - `exclusive` — use the intents (`ours.intents`, `theirs.intents`) to pick whichever side's stated goal still applies. If both still apply, ask the user.
   - `unknown` — read the code and intents directly.
3. **Apply** the resolution with `Edit`. Remove all conflict markers.
4. **Stage**: `git add <file>`.

Treat `hoggit_proposal`, when present, as a strong hint to verify — not a blind directive.

If a commit's changes have already been applied to the current branch (e.g. via a previous merge), the brief's `classification` will often be `compatible` with identical content on both sides. In that case `git cherry-pick --skip` is the right move — but prefer letting `hoggit resolve` handle the duplicate detection itself rather than skipping manually.

If you cannot confidently resolve a hunk, stop and surface the unresolved briefs to the user.

### 6. Continue the cherry-pick

Once all conflicted files are staged:

```
hoggit resolve --continue
```

This runs `git cherry-pick --continue`, which finishes the current commit and advances to the next one in the queue. **Loop back to Step 4** if any remain — `CHERRY_PICK_HEAD` will reappear if the next commit also conflicts.

When the queue is empty, report:

- The new `HEAD` (`git log -<N> --oneline`)
- A one-line summary of what was resolved (commits picked cleanly vs. with conflicts; auto-resolved files vs. agent-resolved hunks)

## Aborting and skipping

If the user asks to abort, run:

```
hoggit resolve --abort
```

This runs `git cherry-pick --abort` and returns to the state before the cherry-pick started.

If the user asks to skip the current commit (e.g. it turned out to be a duplicate that `hoggit resolve` couldn't auto-detect), run `git cherry-pick --skip` directly, then loop back to Step 4 if more commits remain. The `--skip` form is not exposed via `hoggit resolve`.

## Output style

- Lead with what happened. "Cherry-picked 3 commits onto `haacked/feature-x` (1 had conflicts, all auto-resolved)" beats narrating each step.
- Only show resolution briefs when you couldn't resolve them yourself.
- For ranges, group the report by logical unit rather than per-commit.
