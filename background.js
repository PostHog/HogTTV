// Service worker — makes Slack API calls on behalf of content/popup scripts.
// host_permissions grants cross-origin fetch to slack.com without CORS issues.

const CACHE_KEY = 'emojiCache';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_EMOJIS') {
    fetchAndCacheEmojis(message.token).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_CACHED_EMOJIS') {
    getCachedEmojis().then(sendResponse);
    return true;
  }
});

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
