const dot = document.getElementById('dot');
const statText = document.getElementById('stat-text');
const refreshBtn = document.getElementById('refresh-btn');
const optionsBtn = document.getElementById('options-btn');

optionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  statText.textContent = 'Refreshing…';
  dot.className = 'status-dot';

  await chrome.storage.local.remove('emojiCache');
  const result = await sendMessage({ type: 'FETCH_EMOJIS' });
  showResult(result);
  refreshBtn.disabled = false;
});

// Show cached state on open
(async () => {
  const result = await sendMessage({ type: 'FETCH_EMOJIS' });
  showResult(result);
})();

function showResult(result) {
  if (result.error) {
    dot.className = 'status-dot err';
    statText.textContent = result.error.includes('No Slack token')
      ? 'No token set — open settings.'
      : `Error: ${result.error}`;
  } else {
    const count = Object.keys(result.emojis).length;
    dot.className = 'status-dot ok';
    statText.innerHTML = `<strong>${count}</strong> emojis loaded${result.fromCache ? ' (cached)' : ''}`;
  }
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}
