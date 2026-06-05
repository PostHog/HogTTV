// Service worker — makes Slack API calls on behalf of content/popup scripts.
// host_permissions grants cross-origin fetch to slack.com without CORS issues.

const CACHE_KEY = 'emojiCache';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const CLIENT_ID = '910200304849.11123754217221';
const SERVER_CALLBACK = 'https://hogttv-server.vercel.app/api/oauth/callback';

// On fresh install, open the onboarding page in a new tab so users know to
// connect to Slack without having to discover the toolbar popup first.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CONNECT_SLACK') {
    connectSlack().then(sendResponse);
    return true;
  }
  if (message.type === 'FETCH_EMOJIS') {
    fetchAndCacheEmojis(message.token).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_CACHED_EMOJIS') {
    getCachedEmojis().then(sendResponse);
    return true;
  }
});

// Runs the full OAuth round-trip and an immediate emoji sync in the service
// worker, so it completes even when the popup is torn down by the OAuth window
// taking focus.
async function connectSlack() {
  let resultUrl;
  try {
    // Pass the extension's redirect URL as state so the server knows where to
    // send the token without needing the extension ID hardcoded server-side.
    const redirectUrl = chrome.identity.getRedirectURL();
    const authUrl = 'https://slack.com/oauth/v2/authorize'
      + `?client_id=${CLIENT_ID}`
      + `&user_scope=emoji:read`
      + `&redirect_uri=${encodeURIComponent(SERVER_CALLBACK)}`
      + `&state=${encodeURIComponent(redirectUrl)}`;

    resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  } catch {
    return { success: false, cancelled: true };
  }

  const params = new URL(resultUrl).searchParams;
  const error = params.get('error');
  if (error) {
    return { success: false, error };
  }

  const token = params.get('token');
  const team = params.get('team') ?? '';
  await chrome.storage.local.set({ slackToken: token, slackTeam: team });

  const synced = await fetchAndCacheEmojis(token);
  if (synced.success) {
    return { success: true, team, count: synced.count };
  }
  return { success: false, team, error: synced.error };
}

async function fetchAndCacheEmojis(token) {
  try {
    const res = await fetch('https://slack.com/api/emoji.list', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!data.ok) {
      return { success: false, error: data.error };
    }

    // Separate direct URLs from aliases so we can resolve them.
    const direct = {};
    const aliases = {};
    for (const [name, url] of Object.entries(data.emoji)) {
      if (url.startsWith('alias:')) {
        aliases[name] = url.slice('alias:'.length);
      } else {
        direct[name] = url;
      }
    }
    // Resolve one level of aliases (Slack doesn't nest deeper).
    for (const [name, target] of Object.entries(aliases)) {
      if (direct[target]) direct[name] = direct[target];
    }

    await chrome.storage.local.set({
      [CACHE_KEY]: { emojis: direct, fetchedAt: Date.now() },
    });

    return { success: true, count: Object.keys(direct).length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getCachedEmojis() {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const cache = stored[CACHE_KEY];
  if (!cache) return { emojis: {}, stale: true };
  const stale = Date.now() - cache.fetchedAt > CACHE_TTL_MS;
  return { emojis: cache.emojis, fetchedAt: cache.fetchedAt, stale };
}
