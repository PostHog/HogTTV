// Onboarding page shown in a new tab right after install (see background.js's
// chrome.runtime.onInstalled handler). Reuses the same CONNECT_SLACK flow the
// popup uses, so connecting from here behaves identically.

const connectBtn = document.getElementById('connectBtn');
const statusEl = document.getElementById('status');
const workspaceEl = document.getElementById('workspaceName');
const connectedView = document.getElementById('connectedView');
const disconnectedView = document.getElementById('disconnectedView');

// ── Startup ───────────────────────────────────────────────────────────────────

(async () => {
  // If they reopen this page after already connecting, skip straight to the
  // "you're all set" state instead of prompting again.
  const { slackToken, slackTeam } = await chrome.storage.local.get(['slackToken', 'slackTeam']);
  if (slackToken) showConnected(slackTeam);
})();

// ── OAuth connect ─────────────────────────────────────────────────────────────

connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  clearStatus();

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

// ── View helpers ──────────────────────────────────────────────────────────────

function showConnected(team) {
  connectedView.style.display = 'block';
  disconnectedView.style.display = 'none';
  workspaceEl.textContent = team || 'your workspace';
}

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function clearStatus() {
  statusEl.textContent = '';
  statusEl.className = '';
}
