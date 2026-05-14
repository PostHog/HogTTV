const SLACK_API_BASE = 'https://slack.com/api';
const CACHE_KEY = 'emojiCache';
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_EMOJIS') {
    fetchEmojis().then(sendResponse).catch((err) => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === 'REFRESH_EMOJIS') {
    refreshEmojis().then(sendResponse).catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'PROXY_IMAGE') {
    // Returns the image as a data URL to avoid CSP issues on meet.google.com
    proxyImage(message.url).then(sendResponse).catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

async function getToken() {
  const { slackToken } = await chrome.storage.local.get('slackToken');
  if (!slackToken) throw new Error('No Slack token configured. Open HogTTV options to add one.');
  return slackToken;
}

async function fetchEmojis() {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const cache = stored[CACHE_KEY];
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { emojis: cache.emojis, fromCache: true };
  }
  return refreshEmojis();
}

async function refreshEmojis() {
  const token = await getToken();
  const res = await fetch(`${SLACK_API_BASE}/emoji.list`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`Slack API error: ${res.status}`);

  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API: ${data.error}`);

  // Resolve aliases — aliases point to other emoji names, not URLs
  const raw = data.emoji;
  const emojis = resolveAliases(raw);

  const cache = { emojis, fetchedAt: Date.now() };
  await chrome.storage.local.set({ [CACHE_KEY]: cache });

  return { emojis, fromCache: false };
}

function resolveAliases(raw) {
  const resolved = {};
  // First pass: collect non-aliases
  for (const [name, value] of Object.entries(raw)) {
    if (!value.startsWith('alias:')) {
      resolved[name] = value;
    }
  }
  // Second pass: resolve aliases (one level deep is enough for Slack)
  for (const [name, value] of Object.entries(raw)) {
    if (value.startsWith('alias:')) {
      const target = value.slice('alias:'.length);
      if (resolved[target]) {
        resolved[name] = resolved[target];
      }
    }
  }
  return resolved;
}

async function proxyImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve({ dataUrl: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
