# HogTTV

Use your custom Slack emotes in Google Meet.

<img width="1411" height="708" alt="image" src="https://github.com/user-attachments/assets/c0d23721-99e8-4260-85e6-8042ae1693d1" />

## What it does

- Adds a smiley button next to the Google Meet chat input
- Lets you search and insert custom Slack emojis as `:emoji_name:` shortcodes
- Renders incoming `:emoji_name:` shortcodes in chat messages as images
- Inline autocomplete: type `:bufo` and hit Enter to complete

## Install

1. **[Download the latest zip](https://github.com/PostHog/HogTTV/archive/refs/heads/main.zip)**
2. Unzip it
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** → select the unzipped `HogTTV-main` folder
6. The HogTTV icon appears in your toolbar

## Connect to Slack

1. Click the HogTTV icon in your toolbar
2. Click **Connect to Slack** and authorize it in your workspace
3. Your emojis sync automatically — done!

## Usage

- Open Google Meet chat and click the **smiley button** next to the send button to browse emojis
- Or type `:emoji_name` in the chat input for inline autocomplete — press **Enter** or **Tab** to insert
- Emoji list is cached for 4 hours; re-sync from the popup if needed

## Self-hosting / contributing

The extension uses a Slack OAuth app to fetch your workspace's custom emojis. If you want to run your own fork with a separate Slack app:

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) with the `emoji:read` scope
2. Replace `CLIENT_ID` in `popup.js:1` with your app's Client ID
3. Deploy `server/` to Vercel (or any host) and set the env vars from `server/.env.example`
4. Update `SERVER_CALLBACK` in `popup.js:2` to point to your deployed server

The Client ID in this repo belongs to the canonical HogTTV Slack app and is safe to keep for personal installs, but forks should use their own app.

## Privacy

HogTTV stores the following data **locally on your device** using Chrome's built-in storage API:

- **Slack OAuth token** — used to fetch your custom emoji list from the Slack API. Never sent anywhere other than Slack.
- **Workspace name** — displayed in the popup so you know which workspace is connected.
- **Emoji cache** — a local copy of emoji names and image URLs, refreshed every 4 hours.

We do not collect names, email addresses, message content, browsing history, or any other personal information. No data is sold or shared with any third party.

**OAuth server:** Completing the Slack OAuth flow requires a server-side code exchange (doing it in the extension would expose the client secret). HogTTV uses a minimal stateless server at `hogttv-server.vercel.app` solely for this — it receives the authorization code, exchanges it for a token, and immediately redirects the token back to your extension. It does not log or store anything.

**Deletion:** Click **Disconnect** in the popup to clear all stored tokens and cached emojis. Uninstalling the extension removes all local data automatically.

Questions? [Open an issue](https://github.com/PostHog/HogTTV/issues).

## Notes

- Google Meet's DOM changes frequently — if the button doesn't appear, reload the extension at `chrome://extensions`
- Only works in standard Google Meet calls (not the new embedded 1:1 chat UI)
