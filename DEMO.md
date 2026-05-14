# HogTTV — Hoggit Demo Script

## Setup

```
git clone https://github.com/jina-yoon/HogTTV
cd HogTTV
npm install
```

---

## Demo 1: `hoggit show` — The magic number

**The change:** `entries.slice(0, 300)` → `entries.slice(0, 150)` in the emoji picker grid.

**The commit message:** `fix laggy emoji picker UI`

From the diff alone, this is a total mystery. Why 150? Why not 100? Why not 300?

```
hoggit show f271118
```

The intent surfaces: tested against a Slack workspace with 1,200 custom emojis — injecting all of them into Meet's DOM at once caused noticeable frame drops. Profiled in Chrome DevTools: layout thrash from image loads was the bottleneck. Bisected down to 150 as the threshold where the picker stays reliably smooth. Anything above needs lazy rendering or a virtual list.

**The point:** the number is invisible from the diff. The reasoning only lives in the session.

---

## Demo 2: `hoggit blame` — The magic number in context

**The question in the user's head:** "Why is there a hard cap at all? Why 150?"

```
hoggit blame -L 164,164 content.js
```

Shows three rails for every commit touching that line:

1. **The diff** — `300 → 150`, just a number change
2. **The commit message** — `fix laggy emoji picker UI` (tells you nothing about why 150)
3. **The intent** — 1,200-emoji workspace, layout thrash from image loads, bisected to 150 as the reliable smooth threshold, anything above needs lazy rendering

Or blame the whole file:

```
hoggit blame content.js
```

**The point:** standard `git blame` tells you who changed the line and when. `hoggit blame` tells you why — without having to track down the author or dig through Slack history.

---

## Demo 3: `hoggit bisect` — The attributes flag

**Say:** "Let's take another example. Say your team has been working on this project for a few days now and noticed that recently, your Google Meet got super laggy, and emojis are flickering in chat. It wasn't like this a few commits ago. Don't know which commit broke it, but I can describe the symptom."

**Show:**
```
hoggit bisect start "Meet becomes sluggish, emoji picker causes constant flickering"
```

**Show:** TODO — step through bisect manually or with a repro script.

**Show:** Once bisect lands on `bbbda74`, run:
```
hoggit bisect explain
```

**Show:** The intent surfaces: *"Meet does silent attribute-only DOM refreshes when participants join — `childList` alone doesn't catch those. `attributes: true` was added to fix that. Known tradeoff: fires on every attribute change in Meet's entire DOM. `attributeFilter` is the right next step if perf becomes a problem."*

**Say:** "Notice how the actual diff is just one word — `attributes: true`. It looks like a dumb mistake, but the intent hoggit provides makes the tradeoff obvious and tells you exactly what invariant to preserve when fixing it."

---

## Demo 4: `hoggit bisect` + unit tests — The fragments guard

**Say:** "Here's another one. This time someone filed a bug — lone emoji messages aren't rendering at all. You send just `:bufo-alarma:` on its own and it shows up as plain text. Mixed messages like 'nice work :thumbsup:' still work fine. Weird edge case, no idea when it broke."

**Show:**
```
hoggit bisect start "lone emoji messages don't render — :bufo-alarma: shows as plain text" --good 8fdefe5 --bad HEAD
```

**Show:** Now instead of manually stepping through commits, we have a test. Hand it straight to bisect:
```
git bisect run node test/emoji.js
```

**Show:** Bisect runs automatically — exits 0 on good commits, exits 1 on bad ones. Watch it narrow down to `74d39dd` in a few iterations.

**Show:** Once bisect lands on `74d39dd`, run:
```
hoggit bisect explain
```

**Show:** The intent surfaces: *"replacing a text node with a single child — just one `<img>`, no surrounding text nodes — was causing Meet's internal DOM walker to lose track of the message element. Changed `fragments.length === 0` to `fragments.length < 2` so we only proceed when there's both an image and at least one text fragment. Lone-emoji messages were rare in our test calls so the edge case wasn't caught before shipping."*

**Say:** "The diff is literally two characters — `=== 0` becomes `< 2`. It sounds completely defensive and reasonable. The intent is what tells you the assumption was wrong, what Meet behavior the agent was trying to protect against, and crucially — why the agent never caught it. Without this, you're left staring at a one-character change wondering what the original author was thinking."

---

## Closer

**Say:** "In both cases the fix is obvious once you see it. But the *reason* for the original code — the thing that tells you whether your fix is safe — only exists because hoggit captured it at the time."
