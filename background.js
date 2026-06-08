// Service worker — makes Slack API calls on behalf of content/popup scripts.
// host_permissions grants cross-origin fetch to slack.com without CORS issues.

const CACHE_KEY = 'emojiCache';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const CLIENT_ID = '910200304849.11123754217221';
const SERVER_CALLBACK = 'https://hogttv-server.vercel.app/api/oauth/callback';
// The server bounces the finished OAuth flow to this page carrying the token in
// the URL. We open auth in a normal tab (so the user's existing Slack login is
// reused) and watch for the tab to land here, rather than relying on
// launchWebAuthFlow's isolated-session redirect interception.
const RESULT_PAGE = 'https://hogttv-server.vercel.app/api/oauth/result';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // give up (and clean up the tab) after 5 min

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
// worker, so it completes even when the popup is torn down by the auth tab
// taking focus.
async function connectSlack() {
  let result;
  try {
    result = await runOAuthInTab();
  } catch {
    return { success: false, cancelled: true };
  }

  if (result.cancelled) {
    return { success: false, cancelled: true };
  }
  if (result.error) {
    return { success: false, error: result.error };
  }

  const token = result.token;
  const team = result.team ?? '';
  await chrome.storage.local.set({ slackToken: token, slackTeam: team });

  const synced = await fetchAndCacheEmojis(token);
  if (synced.success) {
    return { success: true, team, count: synced.count };
  }
  return { success: false, team, error: synced.error };
}

// Opens Slack's authorize page in a normal browser tab — which shares the
// profile's cookies, so an already-signed-in user goes straight to the
// "Authorize / pick workspace" screen — then watches that tab for the redirect
// to RESULT_PAGE and reads the token out of its URL. Resolves with one of
// { token, team } | { error } | { cancelled: true }.
function runOAuthInTab() {
  // CSRF nonce: round-trips through the server as `state` and is verified on
  // the way back so a stray result navigation can't inject a foreign token.
  const nonce = crypto.randomUUID();
  const authUrl = 'https://slack.com/oauth/v2/authorize'
    + `?client_id=${CLIENT_ID}`
    + `&user_scope=emoji:read`
    + `&redirect_uri=${encodeURIComponent(SERVER_CALLBACK)}`
    + `&state=${encodeURIComponent(nonce)}`;

  return new Promise((resolve, reject) => {
    let authTabId;
    let settled = false;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
    };

    // Resolve once, then close the auth tab so the user isn't left on a
    // leftover result page.
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (authTabId !== undefined) {
        chrome.tabs.remove(authTabId).catch(() => {});
      }
      resolve(value);
    };

    const onUpdated = (tabId, changeInfo) => {
      if (tabId !== authTabId) return;
      // host_permissions for the server grant visibility of the URL; it appears
      // on the 'loading' update, so we can read the token before the page even
      // paints and then close the tab immediately.
      const url = changeInfo.url;
      if (!url || !url.startsWith(RESULT_PAGE)) return;

      const params = new URL(url).searchParams;
      if (params.get('state') !== nonce) return; // not our flow — ignore

      const error = params.get('error');
      if (error) {
        finish({ error });
        return;
      }
      finish({ token: params.get('token'), team: params.get('team') ?? '' });
    };

    // User closed the auth tab before finishing → treat as cancelled.
    const onRemoved = (tabId) => {
      if (tabId === authTabId) finish({ cancelled: true });
    };

    // Backstop: never leave a dangling listener or an orphaned tab.
    const timer = setTimeout(() => finish({ error: 'timeout' }), AUTH_TIMEOUT_MS);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs.create({ url: authUrl, active: true }).then(
      (tab) => { authTabId = tab.id; },
      (err) => { cleanup(); reject(err); },
    );
  });
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
    // Resolve alias chains: Slack aliases can point at other aliases
    // (alias -> alias -> ... -> direct URL), so follow each chain to its
    // root rather than resolving a single hop. A single-pass, one-level
    // resolve silently drops every alias whose target is itself an alias.
    for (const name of Object.keys(aliases)) {
      let target = aliases[name];
      const seen = new Set([name]); // guard against cyclic aliases
      while (target && !direct[target] && aliases[target] && !seen.has(target)) {
        seen.add(target);
        target = aliases[target];
      }
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
