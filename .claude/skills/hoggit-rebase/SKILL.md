---
name: hoggit-rebase
description: Rebase with intent-aware conflict resolution and intent ref migration. Runs `hoggit rebase` (which wraps `git rebase` and tracks old→new SHA rewrites), and on conflict delegates to `hoggit resolve` for lockfile autoresolution, structural 3-way merge, and intent-driven duplicate detection. Use when the user runs /hoggit-rebase <upstream>…
argument-hint: <upstream> [branch] [git-rebase-flags…]
allowed-tools: [Bash, Read, Edit]
---

# hoggit-rebase

Rebase with intent-aware conflict resolution. Unlike the other `hoggit-*` skills, this one calls `hoggit rebase` (the CLI command), not plain `git rebase`. The CLI installs a temporary `post-rewrite` hook for the duration of the rebase to record every old→new commit SHA, then migrates intent refs across those rewrites once the rebase completes — without it, every rebase would silently lose intent.

## When to use

- Updating a feature branch onto the latest upstream
- Reorganizing commits with an interactive rebase (`-i`)
- Recovering a stalled rebase that left conflicts (run `/hoggit-rebase --continue` or `/hoggit-rebase` with no args to resume)

## Arguments

- `<upstream>` — usually `main`, `origin/main`, or a target branch. Required *unless* a rebase is already in progress.
- `[branch]` — optional branch to check out before rebasing (passed through to `git rebase`).
- Flags like `-i`, `--onto`, `--rebase-merges`, `--keep-base`, `--exec` are forwarded verbatim to `git rebase`.
- Resume flags `--continue`, `--abort`, `--skip`, `--quit`, `--edit-todo` are forwarded to `git rebase` directly (the CLI doesn't reinstall the hook in these cases — it's already in place from the original invocation).

## Steps

### 1. Detect existing rebase state

```
GIT_DIR="$(git rev-parse --git-dir)"
test -d "$GIT_DIR/rebase-merge" -o -d "$GIT_DIR/rebase-apply" && echo "rebase in progress"
```

If a rebase is in progress and no args were given (or the user explicitly passed `--continue`), resume by invoking `hoggit rebase --continue` and jumping to Step 4.

If no rebase is in progress and no `<upstream>` was given, stop and tell the user:

> Please provide an upstream to rebase onto. Usage: `/hoggit-rebase <upstream>` (e.g. `main`, `origin/main`).

### 2. Validate the upstream

```
git rev-parse --verify <upstream>
```

If this fails, stop and report: "`<upstream>` is not a valid commit reference."

Verify the working tree is clean:

```
git status --porcelain
```

If there are unstaged changes, stop and report what's dirty.

### 3. Run hoggit rebase

```
hoggit rebase <upstream> [forwarded-flags…]
```

Capture stderr and the exit code. `hoggit rebase` returns non-zero only when something genuinely failed — a rebase that pauses on conflict prints a hint to stderr and returns non-zero with the rebase state still active.

- **Exit 0**: Rebase complete and intents migrated. The command prints `Rebase complete: …` with the migration summary. Report the new `HEAD` (`git log -1 --oneline`) and stop.
- **Non-zero AND rebase state active** (check `$GIT_DIR/rebase-merge/` or `$GIT_DIR/rebase-apply/`): conflict pause. Proceed to Step 4. The CLI's stderr says exactly that; it expects you to run `hoggit resolve` next.
- **Non-zero AND no rebase state**: a genuine git error (e.g., dirty tree, invalid upstream). Report stderr verbatim and stop.

### 4. Run hoggit resolve

```
hoggit resolve
```

Capture stdout (JSONL `ResolutionBrief` lines, if any) and the exit code.

- **Exit 0**: Resolve handled the current step's conflicts and ran `git rebase --continue`. Check whether the rebase is still in progress:

  ```
  test -d "$GIT_DIR/rebase-merge" -o -d "$GIT_DIR/rebase-apply" && echo "rebase still in progress"
  ```

  If yes, **loop back to Step 4** — the next commit conflicted. Otherwise the rebase finished; **proceed to Step 6** to finalize via `hoggit rebase --continue`, which is what runs migration and cleans up the post-rewrite hook installed by the original `hoggit rebase` invocation.

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

**For rebase specifically**, the orientation of `ours` and `theirs` is flipped relative to merge: during rebase, `ours` is the upstream (the new base) and `theirs` is the commit being replayed (the agent's work). The brief sides follow git's `--ours`/`--theirs` naming, so read `theirs.intents` for the intent of the commit being replayed, and `ours.intents` for whatever lives on the new base.

For each brief:

1. **Read** the conflicted region of `file`.
2. **Decide** based on `classification`:
   - `orthogonal` — combine both sides; they touch unrelated things.
   - `compatible` — pick the clearer expression of the shared intent (or merge them).
   - `exclusive` — the most common rebase case is a stacked-PR duplicate that `hoggit resolve` already auto-detects; if it didn't, examine `theirs.intents` (the replayed commit's intent) for headers like `rebased_from` or `superseded_by` pointing to a commit reachable from HEAD. If the upstream has fully subsumed your change, drop `theirs`. Otherwise apply the agent's intent against the new base.
   - `unknown` — read the code and intents directly.
3. **Apply** the resolution with `Edit`. Remove all conflict markers.
4. **Stage**: `git add <file>`.

Treat `hoggit_proposal`, when present, as a strong hint to verify — not a blind directive.

If you cannot confidently resolve a hunk, stop and surface the unresolved briefs to the user.

### 6. Continue (and finalize) the rebase

Once all conflicted files are staged:

```
hoggit resolve --continue
```

This runs `git rebase --continue`, which advances to the next commit. **Loop back to Step 4** if the rebase is still in progress (another conflict).

When `git status` shows the rebase is no longer in progress, finalize:

```
hoggit rebase --continue
```

This is what triggers intent ref migration and cleans up the temporary `post-rewrite` hook installed by the original `hoggit rebase` invocation. It runs whether the user resolved via `hoggit resolve` or via plain `git rebase --continue` calls.

The summary line tells you what happened:

- `Rebase complete: 6 commit(s) rewritten, 6 intent ref(s) migrated.` — happy path.
- `Rebase complete: 4 commit(s) rewritten, 2 intent ref(s) migrated, 2 salvaged to refs/hoggit/squashed/ (collapsed by squash/fixup).` — interactive rebase squashed two intent-bearing commits; the loser's intents are preserved under `refs/hoggit/squashed/<new>/<old>` for manual recovery, not silently dropped.
- `Rebase complete: 3 commit(s) rewritten, no intents to migrate.` — none of the replayed commits had captured intents.

Report the new `HEAD` (`git log -1 --oneline`) and the summary back to the user.

## Aborting

```
hoggit rebase --abort
```

Runs `git rebase --abort` and cleans up the temporary `post-rewrite` hook. No intent migration runs — no commits were finalized, so there's nothing to migrate. Use `hoggit rebase --abort` (not `hoggit resolve --abort`) so the hook cleanup happens; if you used `hoggit resolve --abort` instead, follow it with `hoggit rebase --continue` to finalize the cleanup.

## Why `hoggit rebase`, not `git rebase`

The conflict-resolution flow (`hoggit resolve`) is the same one used by the other `hoggit-*` skills, and works regardless of which command started the rebase. So why call `hoggit rebase`?

**SHA migration.** Every commit replayed by a rebase gets a new SHA. Intents are stored on refs keyed by SHA (`refs/hoggit/base/<sha>`), so without something walking the old→new mapping and moving the refs, every rebase silently strips intent from the replayed commits. `hoggit rebase` is the only entry point that handles this — it installs a `post-rewrite` hook that fires at the end of the rebase with the full mapping, and migrates each ref.

That's also why this skill calls `hoggit rebase` directly instead of running `git rebase` and falling back to `hoggit resolve` on conflict (the pattern used by `hoggit-merge`, `hoggit-pull`, `hoggit-cherry-pick`). Those ops don't rewrite SHAs, so they don't need the migration step.

## Output style

- Lead with what happened. "Rebased 6 commits onto `origin/main` (2 had conflicts, all auto-resolved; 6 intent refs migrated)" beats narrating each step.
- For interactive rebases (`-i`), mention any squashes/fixups/drops that changed the rewrite mapping (N old → 1 new, etc.).
- Only show resolution briefs when you couldn't resolve them yourself.
