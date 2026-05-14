const tokenInput = document.getElementById('token-input');
const saveBtn = document.getElementById('save-btn');
const refreshBtn = document.getElementById('refresh-btn');
const statusEl = document.getElementById('status');
const previewCard = document.getElementById('preview-card');
const emojiCount = document.getElementById('emoji-count');
const emojiPreview = document.getElementById('emoji-preview');

// Load saved token on open
chrome.storage.local.get('slackToken', ({ slackToken }) => {
  if (slackToken) {
    tokenInput.value = slackToken;
    loadAndShowEmojis(false);
  }
});

saveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus('Please enter a token.', 'err');
    return;
  }

  saveBtn.disabled = true;
  setStatus('Saving and testing…', 'loading');

  await chrome.storage.local.set({ slackToken: token });

  // Clear old cache so we force a fresh fetch
  await chrome.storage.local.remove('emojiCache');

  await loadAndShowEmojis(true);
  saveBtn.disabled = false;
});

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  setStatus('Refreshing…', 'loading');
  await chrome.storage.local.remove('emojiCache');
  await loadAndShowEmojis(true);
  refreshBtn.disabled = false;
});

async function loadAndShowEmojis(showResult) {
  try {
    const result = await sendMessage({ type: 'FETCH_EMOJIS' });
    if (result.error) {
      setStatus(`Error: ${result.error}`, 'err');
      return;
    }

    const entries = Object.entries(result.emojis);
    emojiCount.textContent = entries.length;
    previewCard.hidden = false;
    refreshBtn.disabled = false;

    if (showResult) {
      setStatus(`Loaded ${entries.length} emojis successfully.`, 'ok');
    } else {
      setStatus(`${entries.length} emojis cached.`, 'ok');
    }

    renderPreview(entries.slice(0, 60)); // show first 60 as preview
  } catch (e) {
    setStatus(`Failed: ${e.message}`, 'err');
  }
}

function renderPreview(entries) {
  emojiPreview.innerHTML = '';
  for (const [name, url] of entries) {
    const item = document.createElement('div');
    item.className = 'preview-item';

    const img = document.createElement('img');
    img.src = url;
    img.alt = `:${name}:`;
    img.loading = 'lazy';

    const label = document.createElement('span');
    label.textContent = name;

    item.appendChild(img);
    item.appendChild(label);
    emojiPreview.appendChild(item);
  }
}

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}
