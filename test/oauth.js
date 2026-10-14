'use strict';
// Tests for the Slack OAuth flow in background.js.
// Firefox suspends the background event page after ~30s idle, and Chrome stops
// its service worker the same way, so a connect must survive a background restart.
// Exit 0 = all pass, non-zero = failure.

const fs = require('fs');
const vm = require('vm');

const RESULT_PAGE = 'https://hogttv-server.vercel.app/api/oauth/result';
const AUTH_TAB_ID = 42;

function createBrowser() {
  const areas = { local: {}, session: {} };
  const changeListeners = [];
  const removedTabs = [];
  const createdTabs = [];

  const storageArea = (name) => ({
    async get(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => k in areas[name]).map((k) => [k, areas[name][k]]));
    },
    async set(items) {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: areas[name][key], newValue: value };
        areas[name][key] = value;
      }
      changeListeners.forEach((listener) => listener(changes, name));
    },
    async remove(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      list.forEach((key) => delete areas[name][key]);
    },
  });

  return { areas, changeListeners, removedTabs, createdTabs, storageArea };
}

function bootBackground(browser) {
  const listeners = { message: [], updated: [], removed: [] };
  const event = (list) => ({ addListener: (fn) => list.push(fn), removeListener: () => {} });

  const chrome = {
    runtime: {
      onInstalled: event([]),
      onMessage: event(listeners.message),
      getURL: (path) => `moz-extension://test/${path}`,
    },
    tabs: {
      onUpdated: event(listeners.updated),
      onRemoved: event(listeners.removed),
      async create({ url }) {
        browser.createdTabs.push(url);
        return { id: AUTH_TAB_ID };
      },
      async remove(tabId) {
        browser.removedTabs.push(tabId);
      },
    },
    storage: {
      local: browser.storageArea('local'),
      session: browser.storageArea('session'),
      onChanged: event(browser.changeListeners),
    },
  };

  const fetch = async () => ({
    json: async () => ({ ok: true, emoji: { party: 'https://example.com/party.png' } }),
  });

  vm.runInContext(
    fs.readFileSync('./background.js', 'utf8'),
    vm.createContext({ chrome, fetch, crypto: { randomUUID: () => 'nonce-1234' }, URL, setTimeout, clearTimeout, console }),
  );

  return {
    sendMessage: (message) => new Promise((resolve) => {
      listeners.message.forEach((fn) => fn(message, {}, resolve));
    }),
    tabUpdated: (tabId, changeInfo) => listeners.updated.forEach((fn) => fn(tabId, changeInfo, {})),
    tabRemoved: (tabId) => listeners.removed.forEach((fn) => fn(tabId, {})),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function startConnectThenRestartBackground() {
  const browser = createBrowser();
  const firstBackground = bootBackground(browser);
  firstBackground.sendMessage({ type: 'CONNECT_SLACK' });
  await settle();
  const state = new URL(browser.createdTabs[0]).searchParams.get('state');
  return { browser, background: bootBackground(browser), state };
}

function resultUrl(params) {
  return `${RESULT_PAGE}?${new URLSearchParams(params)}`;
}

let failed = false;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}: got ${a}, expected ${e}`);
    failed = true;
  }
}

(async () => {
  {
    const { browser, background, state } = await startConnectThenRestartBackground();
    background.tabUpdated(AUTH_TAB_ID, { url: resultUrl({ state, token: 'xoxp-1', team: 'Hogs' }) });
    await settle();
    check('connect survives a restart: token stored', browser.areas.local.slackToken, 'xoxp-1');
    check('connect survives a restart: emojis synced', browser.areas.local.emojiCache?.emojis, { party: 'https://example.com/party.png' });
    check('connect survives a restart: auth tab closed', browser.removedTabs, [AUTH_TAB_ID]);
    check('connect survives a restart: result reported', browser.areas.session.connectResult, { success: true, team: 'Hogs', count: 1 });
  }
  {
    const { browser, background } = await startConnectThenRestartBackground();
    background.tabRemoved(AUTH_TAB_ID);
    await settle();
    check('closing the auth tab cancels', browser.areas.session.connectResult, { success: false, cancelled: true });
  }
  {
    const { browser, background } = await startConnectThenRestartBackground();
    background.tabUpdated(AUTH_TAB_ID, { url: resultUrl({ state: 'forged', token: 'xoxp-evil' }) });
    await settle();
    check('result with a foreign state is ignored', browser.areas.local.slackToken, undefined);
  }
  {
    const { browser, background, state } = await startConnectThenRestartBackground();
    background.tabUpdated(AUTH_TAB_ID, { url: resultUrl({ state, error: 'wrong_workspace' }) });
    await settle();
    check('Slack error is reported', browser.areas.session.connectResult, { success: false, error: 'wrong_workspace' });
  }
  process.exit(failed ? 1 : 0);
})();
