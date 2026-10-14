# HogTTV — Claude Code context

## What this repo is

A browser extension for Chrome and Firefox that renders custom Slack emojis in Google Meet chat.
One `manifest.json` serves both browsers.

## Tests

```sh
npm install        # first time only — installs jsdom
node test/emoji.js # exit 0 = pass, non-zero = fail
```

## Firefox compatibility

```sh
npx web-ext lint   # 0 errors = publishable on addons.mozilla.org
```
