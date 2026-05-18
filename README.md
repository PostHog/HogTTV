# HogTTV

Use your custom Slack emotes in Google Meet.

<img width="1411" height="708" alt="image" src="https://github.com/user-attachments/assets/c0d23721-99e8-4260-85e6-8042ae1693d1" />

## What it does

- Adds a smiley button next to the Google Meet chat input
- Lets you search and insert custom Slack emojis as `:emoji_name:` shortcodes
- Renders incoming `:emoji_name:` shortcodes in chat messages as images
- Inline autocomplete: type `:bufo` and hit Enter to complete

## Install

1. **[Download the latest zip](https://github.com/jina-yoon/HogTTV/archive/refs/heads/main.zip)**
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

## Notes

- Google Meet's DOM changes frequently — if the button doesn't appear, reload the extension at `chrome://extensions`
- Only works in standard Google Meet calls (not the new embedded 1:1 chat UI)
