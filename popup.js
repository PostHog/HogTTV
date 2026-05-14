const tokenInput = document.getElementById('tokenInput');
const syncBtn = document.getElementById('syncBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const cacheInfoEl = document.getElementById('cacheInfo');

// ── Startup: restore saved token and show cache info ─────────────────────────

(async () => {
  const { slackToken } = await chrome.storage.local.get('slackToken');
  if (slackToken) tokenInput.value = slackToken;

  const res = await chrome.runtime.sendMessage({ type: 'GET_CACHED_EMOJIS' });
  if (res.fetchedAt) {
    const count = Object.keys(res.emojis).length;
    const ago = formatAgo(res.fetchedAt);
    cacheInfoEl.textContent = `${count} emojis cached · synced ${ago}`;
    if (res.stale) showStatus('Cache is over 4 hours old — consider re-syncing.', 'info');
  }
})();

// ── Sync button ───────────────────────────────────────────────────────────────

syncBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showStatus('Please enter your Slack token.', 'error');
    return;
  }

  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing…';
  clearStatus();

  // Persist token so users don't have to re-enter it.
  await chrome.storage.local.set({ slackToken: token });

  const res = await chrome.runtime.sendMessage({ type: 'FETCH_EMOJIS', token });

  syncBtn.disabled = false;
  syncBtn.textContent = 'Sync emojis';

  if (res.success) {
    showStatus(`✓ Synced ${res.count} custom emojis.`, 'success');
    cacheInfoEl.textContent = `${res.count} emojis cached · just now`;
  } else {
    showStatus(`Error: ${res.error}`, 'error');
  }
});

// ── Clear button ──────────────────────────────────────────────────────────────

clearBtn.addEventListener('click', async () => {
  await chrome.storage.local.clear();
  tokenInput.value = '';
  cacheInfoEl.textContent = '';
  showStatus('Token and cache cleared.', 'info');
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function clearStatus() {
  statusEl.textContent = '';
  statusEl.className = '';
}

function formatAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
