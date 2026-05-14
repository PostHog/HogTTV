# HogTTV

Use your custom Slack emotes in Google Meet.

## What it does

- Adds a 🏷 picker button next to the Google Meet chat input
- Lets you search and insert custom Slack emojis as `:emoji_name:` shortcodes
- Renders incoming `:emoji_name:` shortcodes in chat messages as images

## Setup

### 1. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder
4. The extension icon appears in your toolbar

### 2. Get a Slack token

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch
2. Under **OAuth & Permissions** → **User Token Scopes** → add `emoji:read`
3. Click **Install to workspace** → copy the **User OAuth Token** (`xoxp-…`)

### 3. Sync your emojis

1. Click the extension icon in Chrome
2. Paste your token and click **Sync emojis**
3. You should see a count of custom emojis cached

## Testing in Meet

1. Join a Google Meet ([meet.new](https://meet.new) works for solo testing)
2. Open the chat panel
3. Click the 🏷 button next to the chat input to open the emoji picker
4. Search for an emoji and click it — it inserts `:emoji_name:` into the input
5. Incoming messages with `:emoji_name:` shortcodes render as images automatically

## Notes

- Emoji list is cached for 4 hours; re-sync from the popup if needed
- Google Meet's DOM changes frequently — if the 🏷 button doesn't appear, open DevTools on `meet.google.com` and check which `aria-label` the chat textarea has
