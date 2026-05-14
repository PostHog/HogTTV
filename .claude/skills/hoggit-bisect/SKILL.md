---
name: hoggit-bisect
description: Find the commit that introduced a regression. Drives `hoggit bisect` with an agent-authored reproducer, verifies it against both bounds before running, and narrates the result with the commit's intent.
---

# hoggit-bisect

Use this skill when the user says some behavior worked recently and is broken now and they don't know which change caused it. Examples: "rate limiting started firing for everyone last week", "the cohort upload page returns 0 rows since the v1.4 deploy", "this test fails on main but passed Friday".

Do NOT use this skill for:
- Currently-failing CI on a PR that hasn't merged. Run the test locally and read the diff — there's nothing to bisect.
- "Why was this code written this way?" — that's `hoggit show <sha>` or `hoggit blame`.
- Perceptual UI bugs with no programmatic signal ("the chart looks wrong"). Fall through to **Interactive mode** below.

## The verification ladder

The hardest part of any bisect is answering "is the bug here at this commit?" Pick the cheapest rung that works; only fall through when the previous rung doesn't fit.

1. **Existing test the user names.** Best signal, zero work. "`pytest tests/test_cohorts.py::test_upload` — passes = good, fails = bad." Pipe directly to `hoggit bisect run`.

2. **Reproducer you write from the description.** A short script that exits 0 when the behavior is healthy, non-zero when broken. Prefer the smallest unit that exercises the bug:
   - API bug → `curl ... | jq -e '...'`
   - Library/CLI bug → a one-off `pytest` / `cargo test` / equivalent
   - Server-side bug needing a boot → a `docker compose up` + probe script, with a timeout
3. **LLM-judge over deterministic output.** Run a deterministic command, feed its output plus the bug description to a sub-agent, return 0/1. Use when the output is structured but the "rightness" criterion is fuzzy (returns *reasonable* recommendations, *plausible* ranking). Mark as Verdict::Skip if the model is uncertain — better to skip than to mis-mark.

4. **Interactive mode.** For perceptual bugs (UI, charts, animation). The skill checks out each candidate, opens it, asks the user "good or bad?" once per step. Still useful — auto-walkback + worktree isolation + intent narration are wins even without auto-verification.

5. **Property check from intent (stretch).** If the suspect region has hoggit intents with `# Constraints` sections, derive a property ("rate limiter must not read socket peer addr") and check it at each commit. Most powerful when it works; gracefully degrades to a comment when no intent is present.

## Validate the reproducer before bisecting

This step is non-negotiable. A bisect run on a broken repro burns log2(N) iterations and lies to you. Before calling `hoggit bisect run`:

1. Run the repro on `--bad` (typically HEAD). It MUST fail.
2. Run the repro on `--good`. It MUST pass.
3. Note the wall-clock time. If a single run takes >2 minutes, warn the user — a 200-commit bisect is ~8 iterations, so multiply.

If either bound doesn't behave, stop. The bounds are wrong or the repro is wrong. Ask before continuing.

## Workflow

1. **Get the description.** From the slash-command arg, or ask one short question.
2. **Pick a verification strategy** from the ladder above. State which rung and why.
3. **Set bounds.**
   - `bad` defaults to HEAD.
   - For `good`: ask if the user remembers a known-good ref/tag/date. If not, kick off exponential walkback:
     ```
     hoggit bisect start --bad HEAD "<description>"
     ```
     hoggit will walk HEAD~10, ~50, ~200, then the most recent tag, running the repro at each until it passes. Don't reinvent this in the skill — let the engine do it.
4. **Validate the repro** against both bounds (see above).
5. **Run.** `hoggit bisect run -- <repro-cmd>`. Use `--auto-skip-build-failures` (default on) so commits that don't compile get skipped, not marked bad.
6. **Narrate.** When the engine narrows to a SHA, run `hoggit bisect explain`. This reads the intent attached to the commit. Combine intent + diff to summarize:
   - what the change did
   - why (from intent)
   - the most likely line / mechanism causing the regression
   - a suggested fix, framed as a hypothesis, not a decree
7. **Offer to reset.** `hoggit bisect reset` removes the worktree. Ask first; the user may want to poke around in the suspect checkout.

## Stop conditions

Stop and ask the user when:
- The repro can't be validated on both bounds (see above).
- More than 3 consecutive commits get `Skip` — likely the repro is too fragile or the project has a structural break in this range.
- `hoggit bisect explain` finds no intent AND the diff is large/opaque. Say so explicitly; don't fabricate causation.
- The narrowed suspect is a merge commit and `--by pr` wasn't used. Offer to re-run with PR granularity.

## Worktree hygiene

`hoggit bisect start` creates a worktree under `.hoggit/bisect/<run-id>/` by default. Do all checkout/repro work there. Never `cd` into the user's main checkout — they may have uncommitted work. On `reset`, the worktree is removed unless `--keep-worktree`.

## One-shot form

If the user runs `/hoggit-bisect <description>` with a clean enough description and a guessable repro (e.g. they reference a test by name), do the whole flow without asking. Otherwise ask exactly one clarifying question — the bounds question or the repro question, whichever is more uncertain. Don't ask both at once.
