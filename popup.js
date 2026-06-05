const connectBtn = document.getElementById('connectBtn');
const syncBtn = document.getElementById('syncBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const statusEl = document.getElementById('status');
const cacheInfoEl = document.getElementById('cacheInfo');
const workspaceEl = document.getElementById('workspaceName');
const connectedView = document.getElementById('connectedView');
const disconnectedView = document.getElementById('disconnectedView');

// ── Startup ───────────────────────────────────────────────────────────────────

(async () => {
  const { slackToken, slackTeam } = await chrome.storage.local.get(['slackToken', 'slackTeam']);
  if (slackToken) {
    showConnected(slackTeam);
    const res = await chrome.runtime.sendMessage({ type: 'GET_CACHED_EMOJIS' });
    if (res.fetchedAt) {
      const count = Object.keys(res.emojis).length;
      cacheInfoEl.textContent = `${count} emojis · synced ${formatAgo(res.fetchedAt)}`;
      if (res.stale) showStatus('Cache is over 4 hours old — resync to refresh.', 'info');
    } else {
      await doSync(slackToken);
    }
  } else {
    showDisconnected();
  }
})();

// ── OAuth connect ─────────────────────────────────────────────────────────────

connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  clearStatus();

  // The service worker owns the OAuth round-trip and the immediate emoji sync,
  // so the flow completes even if this popup is torn down mid-connect.
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CONNECT_SLACK' });

    if (res.cancelled) {
      showStatus('Connection cancelled.', 'info');
    } else if (!res.success && res.error && res.team === undefined) {
      const msg = res.error === 'wrong_workspace'
        ? 'This workspace is not authorized.'
        : `Slack error: ${res.error}`;
      showStatus(msg, 'error');
    } else {
      showConnected(res.team);
      if (res.success) {
        cacheInfoEl.textContent = `${res.count} emojis · synced just now`;
        showStatus(`Synced ${res.count} emojis.`, 'success');
      } else {
        showStatus(`Sync failed: ${res.error}`, 'error');
      }
    }
  } finally {
    connectBtn.disabled = false;
    connectBtn.innerHTML = '<span class="slack-hash">#</span> Connect to Slack';
  }
});

// ── Sync ──────────────────────────────────────────────────────────────────────

syncBtn.addEventListener('click', async () => {
  const { slackToken } = await chrome.storage.local.get('slackToken');
  if (slackToken) await doSync(slackToken);
});

async function doSync(token) {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing…';
  clearStatus();

  const res = await chrome.runtime.sendMessage({ type: 'FETCH_EMOJIS', token });

  syncBtn.disabled = false;
  syncBtn.textContent = 'Sync emojis';

  if (res.success) {
    cacheInfoEl.textContent = `${res.count} emojis · synced just now`;
    showStatus(`Synced ${res.count} emojis.`, 'success');
  } else {
    showStatus(`Sync failed: ${res.error}`, 'error');
  }
}

// ── Disconnect ────────────────────────────────────────────────────────────────

disconnectBtn.addEventListener('click', async () => {
  await chrome.storage.local.clear();
  showDisconnected();
  clearStatus();
  cacheInfoEl.textContent = '';
});

// ── View helpers ──────────────────────────────────────────────────────────────

function showConnected(team) {
  connectedView.style.display = 'block';
  disconnectedView.style.display = 'none';
  workspaceEl.textContent = team || 'your workspace';
}

function showDisconnected() {
  connectedView.style.display = 'none';
  disconnectedView.style.display = 'block';
}

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
