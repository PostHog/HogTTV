// Background script (a service worker in Chrome, an event page in Firefox) —
// makes Slack API calls on behalf of content/popup scripts.
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
const PENDING_OAUTH_KEY = 'pendingOAuth';
const CONNECT_RESULT_KEY = 'connectResult';

// On fresh install, open the onboarding page in a new tab so users know to
// connect to Slack without having to discover the toolbar popup first.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CONNECT_SLACK') {
    startOAuth().then(sendResponse);
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

// Firefox suspends this background after ~30s idle (and Chrome stops its
// service worker the same way), which easily happens while the user signs in
// to Slack. So the in-flight flow lives in session storage and these listeners
// are registered at top level, letting the browser wake us for the redirect.
chrome.tabs.onUpdated.addListener(onAuthTabUpdated);
chrome.tabs.onRemoved.addListener(onAuthTabRemoved);

// Opens Slack's authorize page in a normal browser tab — which shares the
// profile's cookies, so an already-signed-in user goes straight to the
// "Authorize / pick workspace" screen. The outcome is reported later through
// CONNECT_RESULT_KEY in session storage (see connect.js).
async function startOAuth() {
  const previous = await getPendingOAuth();
  await chrome.storage.session.remove([PENDING_OAUTH_KEY, CONNECT_RESULT_KEY]);
  if (previous) chrome.tabs.remove(previous.tabId).catch(() => {});

  // CSRF nonce: round-trips through the server as `state` and is verified on
  // the way back so a stray result navigation can't inject a foreign token.
  const nonce = crypto.randomUUID();
  try {
    const tab = await chrome.tabs.create({ url: authorizeUrl(nonce), active: true });
    await chrome.storage.session.set({ [PENDING_OAUTH_KEY]: { nonce, tabId: tab.id } });
    return { started: true };
  } catch {
    await reportConnectResult({ success: false, cancelled: true });
    return { started: false };
  }
}

function authorizeUrl(nonce) {
  return 'https://slack.com/oauth/v2/authorize'
    + `?client_id=${CLIENT_ID}`
    + `&user_scope=emoji:read`
    + `&redirect_uri=${encodeURIComponent(SERVER_CALLBACK)}`
    + `&state=${encodeURIComponent(nonce)}`;
}

// host_permissions for the server grant visibility of the URL; it appears on
// the 'loading' update, so we can read the token before the page even paints
// and then close the tab immediately.
function onAuthTabUpdated(tabId, changeInfo) {
  if (!changeInfo.url?.startsWith(RESULT_PAGE)) return;
  completeOAuth(tabId, new URL(changeInfo.url).searchParams);
}

async function completeOAuth(tabId, params) {
  const pending = await getPendingOAuth();
  if (pending?.tabId !== tabId || params.get('state') !== pending.nonce) return;

  // Clear the pending flow before closing the tab, so onAuthTabRemoved doesn't
  // read the close as a cancellation.
  await chrome.storage.session.remove(PENDING_OAUTH_KEY);
  chrome.tabs.remove(tabId).catch(() => {});

  const error = params.get('error');
  await reportConnectResult(error
    ? { success: false, error }
    : await saveConnection(params.get('token'), params.get('team') ?? ''));
}

// User closed the auth tab before finishing → treat as cancelled.
async function onAuthTabRemoved(tabId) {
  const pending = await getPendingOAuth();
  if (pending?.tabId !== tabId) return;
  await chrome.storage.session.remove(PENDING_OAUTH_KEY);
  await reportConnectResult({ success: false, cancelled: true });
}

async function saveConnection(token, team) {
  await chrome.storage.local.set({ slackToken: token, slackTeam: team });
  const synced = await fetchAndCacheEmojis(token);
  if (synced.success) {
    return { success: true, team, count: synced.count };
  }
  return { success: false, team, error: synced.error };
}

async function getPendingOAuth() {
  const stored = await chrome.storage.session.get(PENDING_OAUTH_KEY);
  return stored[PENDING_OAUTH_KEY];
}

function reportConnectResult(result) {
  return chrome.storage.session.set({ [CONNECT_RESULT_KEY]: result });
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
